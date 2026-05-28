import { THREE } from '../three-defs.js';
import { entity } from '../entity.js';
import { ocean_constants } from './ocean-constants.js';
import { ocean_builder_threaded } from './ocean-builder-threaded.js';
import { quadtree } from './quadtree.js';
import { utils } from './utils.js';
import { OceanMaterial } from './ocean-material.js';
import { vec4 } from "three/tsl";
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';



class OceanChunkManager extends entity.Component {

	constructor(params) {

		super();

	}


	async Init(params) {

		this.params_ = params;
		this.builder_ = new ocean_builder_threaded.OceanChunkRebuilder_Threaded();

		this.sun = new THREE.Vector3();

		// WebGPU does not support WebGLCubeRenderTarget.
		// We use the scene's equirectangular HDRI environment directly.
		// The fragment shader already uses equirectangular UV mapping.

		const oceanDatas = {
			...params,
			lodScale: this.params_.waveGenerator.lodScale,
			cascades: this.params_.waveGenerator.cascades,
			waveLengths: this.params_.waveGenerator.waveLengths,
			foamStrength: this.params_.waveGenerator.foamStrength,
			foamThreshold: this.params_.waveGenerator.foamThreshold,
			ifftResolution: this.params_.waveGenerator.size,
			depthTexture: this.params_.depthTexture,
			mySampler: this.params_.mySampler,
			environment: params.scene.environment,
			sunPosition: this.sun,
			oceanReflector: params.oceanReflector
		}

		this.material_ = new OceanMaterial(oceanDatas).oceanMaterial;

		this.InitSky(params);
		this.InitOcean(params);


		this.quadTree = new quadtree.Root({
			size: ocean_constants.OCEAN_SIZE,
			min_lod_radius: ocean_constants.QT_OCEAN_MIN_LOD_RADIUS,
			lod_layers: ocean_constants.QT_OCEAN_MIN_NUM_LAYERS,
			min_node_size: ocean_constants.QT_OCEAN_MIN_CELL_SIZE,
		});

	}


	InitSky(params) {

		const sky = new SkyMesh();
		sky.scale.setScalar(500000);
		params.scene.add(sky);
		this.sky_ = sky;

		params.guiParams.sky = {
			rayleigh: 1,
			elevation: 12,
			azimuth: 100,
			turbidity: 10,
			mieCoefficient: 0.005,
			mieDirectionalG: 0.7,
			up: new THREE.Vector3(0, 1, 0),
			exposure: 0.03,
		}

		// Aplicar parámetros iniciales directamente a los uniforms de SkyMesh
		sky.turbidity.value = params.guiParams.sky.turbidity;
		sky.mieCoefficient.value = params.guiParams.sky.mieCoefficient;
		sky.mieDirectionalG.value = params.guiParams.sky.mieDirectionalG;
		sky.rayleigh.value = params.guiParams.sky.rayleigh;
		// Desactivar el disco solar (multiplicador hardcoded 19000x en el shader)
		// El scattering atmosférico sigue funcionando — solo se elimina el pixel del sol
		sky.showSunDisc.value = 0;

		const phi = THREE.MathUtils.degToRad(90 - params.guiParams.sky.elevation);
		const theta = THREE.MathUtils.degToRad(params.guiParams.sky.azimuth);
		this.sun.setFromSphericalCoords(1, phi, theta);
		sky.sunPosition.value.copy(this.sun);

		// GUI controls
		this.params_.waveGenerator.skySet.add(params.guiParams.sky, "rayleigh", 0, 4, 0.001).onChange((value) => {
			sky.rayleigh.value = value;
		});
		this.params_.waveGenerator.skySet.add(params.guiParams.sky, "elevation", 0, 90, 0.01).onChange((value) => {
			const phi = THREE.MathUtils.degToRad(90 - value);
			const theta = THREE.MathUtils.degToRad(params.guiParams.sky.azimuth);
			this.sun.setFromSphericalCoords(1, phi, theta);
			sky.sunPosition.value.copy(this.sun);
		});
		this.params_.waveGenerator.skySet.add(params.guiParams.sky, "azimuth", -180, 180, 0.1).onChange((value) => {
			const phi = THREE.MathUtils.degToRad(90 - params.guiParams.sky.elevation);
			const theta = THREE.MathUtils.degToRad(value);
			this.sun.setFromSphericalCoords(1, phi, theta);
			sky.sunPosition.value.copy(this.sun);
		});

	}



	InitOcean(params) {

		this.group = new THREE.Group();
		params.scene.add(this.group);
		this.chunks_ = {};

		params.guiParams.ocean = {
			wireframe: false,
			renderRadius: params.oceanConfig.renderRadius,
			falloffDistance: params.oceanConfig.falloffDistance,
			// Material parameters
			seaColor: [0.004, 0.016, 0.047],
			waveColor: [0.014, 0.25, 0.18],
			skyColor: [0.8, 0.588, 0.785],
			roughness: 0.02,
			metallic: 0.8,
		}
		this.params_.waveGenerator.oceanSet.add(params.guiParams.ocean, "wireframe").onChange(() => {
			this.material_.wireframe = params.guiParams.ocean.wireframe;
		});
		this.params_.waveGenerator.oceanSet.add(params.guiParams.ocean, "renderRadius", 100, 5000, 50).onChange((value) => {
			this.material_.colorNode.parameters.renderRadius.value = value;
		});
		this.params_.waveGenerator.oceanSet.add(params.guiParams.ocean, "falloffDistance", 10, 500, 10).onChange((value) => {
			this.material_.colorNode.parameters.falloffDistance.value = value;
		});

		// Material color controls
		this.params_.waveGenerator.oceanSet.addColor(params.guiParams.ocean, "seaColor").onChange((value) => {
			this.material_.colorNode.parameters.seaColor.value.set(value.r / 255, value.g / 255, value.b / 255);
		});
		this.params_.waveGenerator.oceanSet.addColor(params.guiParams.ocean, "waveColor").onChange((value) => {
			this.material_.colorNode.parameters.waveColor.value.set(value.r / 255, value.g / 255, value.b / 255);
		});
		this.params_.waveGenerator.oceanSet.addColor(params.guiParams.ocean, "skyColor").onChange((value) => {
			this.material_.colorNode.parameters.skyColor.value.set(value.r / 255, value.g / 255, value.b / 255);
		});

		// Material properties
		this.params_.waveGenerator.oceanSet.add(params.guiParams.ocean, "roughness", 0, 1, 0.01).onChange((value) => {
			this.material_.colorNode.parameters.roughness.value = value;
		});
		this.params_.waveGenerator.oceanSet.add(params.guiParams.ocean, "metallic", 0, 1, 0.01).onChange((value) => {
			this.material_.colorNode.parameters.metallic.value = value;
		});

	}


	CreateOceanChunk(group, groupTransform, offset, width, resolution, lod) {

		const params = {
			group: group,
			transform: groupTransform,
			width: width,
			offset: offset,
			resolution: resolution,
			lod: lod,
			layer: this.params_.layer,
			material: this.material_
		};

		return this.builder_.AllocateChunk(params);

	}


	Update_(_) {

		const cameraPosition = new THREE.Vector3();
		const scenePosition = new THREE.Vector3();
		this.params_.camera.getWorldPosition(cameraPosition);
		this.params_.scene.getWorldPosition(scenePosition);
		const tempCameraPosition = cameraPosition.clone();
		const relativeCameraPosition = tempCameraPosition.sub(scenePosition);

		this.builder_.Update();

		if (!this.builder_.Busy) {
			for (let k in this.chunks_) {
				this.chunks_[k].chunk.Show();
			}
			this.UpdateVisibleChunks_Quadtree_(relativeCameraPosition);
		}

		for (let k in this.chunks_) {
			this.chunks_[k].chunk.Update(relativeCameraPosition);

			this.chunks_[k].chunk.mesh_.material.wireframe = this.params_.guiParams.ocean.wireframe;
		}
		for (let c of this.builder_.old_) {
			c.chunk.Update(relativeCameraPosition);
		}



		this.material_.positionNode.parameters.cameraPosition.value = relativeCameraPosition;
		this.material_.colorNode.parameters.cameraPosition.value = relativeCameraPosition;
		// Acceder a los uniforms como se hace con cameraPosition
		this.material_.colorNode.parameters.renderRadius.value = this.params_.guiParams.ocean.renderRadius;
		this.material_.colorNode.parameters.falloffDistance.value = this.params_.guiParams.ocean.falloffDistance;

		// Sincronizar parámetros del material
		const seaColor = this.params_.guiParams.ocean.seaColor;
		const waveColor = this.params_.guiParams.ocean.waveColor;
		const skyColor = this.params_.guiParams.ocean.skyColor;

		this.material_.colorNode.parameters.seaColor.value.set(seaColor[0], seaColor[1], seaColor[2]);
		this.material_.colorNode.parameters.waveColor.value.set(waveColor[0], waveColor[1], waveColor[2]);
		this.material_.colorNode.parameters.skyColor.value.set(skyColor[0], skyColor[1], skyColor[2]);
		this.material_.colorNode.parameters.roughness.value = this.params_.guiParams.ocean.roughness;
		this.material_.colorNode.parameters.metallic.value = this.params_.guiParams.ocean.metallic;

		// SkyMesh sigue a la cámara automáticamente (positionWorld - cameraPosition interno)
		if (this.sky_) {
			this.sky_.position.copy(cameraPosition);
		}

	}//end Update



	Key(c) {

		return c.position[0] + '/' + c.position[1] + ' [' + c.size + ']';

	}


	UpdateVisibleChunks_Quadtree_(cameraPosition) {

		this.quadTree.Insert(cameraPosition);

		const sides = this.quadTree.GetChildren();

		let newOceanChunks = {};
		const center = new THREE.Vector3();
		const dimensions = new THREE.Vector3();

		const _Child = (c) => {
			c.bounds.getCenter(center);
			c.bounds.getSize(dimensions);

			const child = {
				group: this.group,
				transform: sides.transform,
				position: [center.x, center.y, center.z],
				bounds: c.bounds,
				size: dimensions.x,
				lod: c.lod,
			};
			return child;
		};


		for (let c of sides.children) {
			const child = _Child(c);
			const k = this.Key(child);

			newOceanChunks[k] = child;
		}


		const intersection = utils.DictIntersection(this.chunks_, newOceanChunks);
		const difference = utils.DictDifference(newOceanChunks, this.chunks_);
		const recycle = Object.values(utils.DictDifference(this.chunks_, newOceanChunks));


		this.builder_.RetireChunks(recycle);

		newOceanChunks = intersection;


		for (let k in difference) {

			const [xp, yp, zp] = difference[k].position;

			const offset = new THREE.Vector3(xp, yp, zp);

			newOceanChunks[k] = {
				position: [xp, zp],
				chunk: this.CreateOceanChunk(
					difference[k].group,
					difference[k].transform,
					offset,
					difference[k].size,
					ocean_constants.QT_OCEAN_MIN_CELL_RESOLUTION,
					difference[k].lod,
				),
			};

		}

		this.chunks_ = newOceanChunks;

	}

}//end class


export default OceanChunkManager;
