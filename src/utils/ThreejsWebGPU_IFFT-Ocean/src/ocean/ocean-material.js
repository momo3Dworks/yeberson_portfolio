import { THREE } from '../three-defs.js';
import { texture, cubeTexture, attribute, uniform, vec3, vec4, color, screenUV, time, sin } from "three/tsl";
import { entity } from '../entity.js';
import { ocean_constants } from './ocean-constants.js';
import { vertexStageWGSL } from '../../resources/shader/ocean/vertexStageWGSL.js';
import { fragmentStageWGSL } from '../../resources/shader/ocean/fragmentStageWGSL.js';



class OceanMaterial extends entity.Component {
	constructor(params) {
		super();
		this.Init(params);
	}

	Init(params) {

		const loader = new THREE.TextureLoader();
		const noiseTexture = loader.load("./resources/textures/simplex-noise.png");
		const testTexture = loader.load("./resources/textures/uv_grid_opengl.jpg");



		const cubeTextureLoader = new THREE.CubeTextureLoader();
		cubeTextureLoader.setPath('./resources/textures/cube/sky/');
		const environmentTexture = cubeTextureLoader.load(['px.jpg', 'nx.jpg', 'py.jpg', 'ny.jpg', 'pz.jpg', 'nz.jpg']);
		//const environmentTexture = cubeTextureLoader.load(['px.png', 'nx.png', 'py.png', 'ny.png', 'pz.png', 'nz.png']);
		environmentTexture.minFilter = THREE.LinearFilter;
		environmentTexture.magFilter = THREE.LinearFilter;



		const wgslShaderParams = {
			time: uniform(0),
			cameraPosition: uniform(new THREE.Vector3()),
			wMatrix: uniform(new THREE.Matrix4()),
			oceanSize: ocean_constants.OCEAN_SIZE,
			minLodRadius: ocean_constants.QT_OCEAN_MIN_LOD_RADIUS,
			numLayers: ocean_constants.QT_OCEAN_MIN_NUM_LAYERS,
			gridResolution: ocean_constants.QT_OCEAN_MIN_CELL_RESOLUTION,
			renderRadius: uniform(100.0),
			falloffDistance: uniform(20.0),
			globalOffset: uniform(new THREE.Vector2(0, 0)),
			seaColor: uniform(color('#0066ff')),
			waveColor: uniform(new THREE.Vector3(0.14, 0.25, 0.18)),
			skyColor: uniform(new THREE.Vector3(0.196, 0.588, 0.785)),
			roughness: uniform(0.1),
			metallic: uniform(0.8),
			opacity: uniform(1.0),
			vMorphedPosition: vertexStageWGSL.vMorphedPosition,
			vDisplacedPosition: vertexStageWGSL.vDisplacedPosition,
			vCascadeScales: vertexStageWGSL.vCascadeScales,
			vTexelCoord0: vertexStageWGSL.vTexelCoord0,
			vTexelCoord1: vertexStageWGSL.vTexelCoord1,
			vTexelCoord2: vertexStageWGSL.vTexelCoord2,
			position: attribute("position"),
			vindex: attribute("vindex"),
			width: attribute("width"),
			lod: attribute("lod"),
			noise: texture(noiseTexture),
			testTexture: texture(testTexture),
			testTexture_sampler: texture(testTexture),
			noiseSampler: texture(noiseTexture),
			ifftResolution: uniform(params.ifftResolution),
			displacement0: texture(params.cascades[0].displacement),
			displacement1: texture(params.cascades[1].displacement),
			displacement2: texture(params.cascades[2].displacement),
			derivatives0: texture(params.cascades[0].derivative),
			derivatives1: texture(params.cascades[1].derivative),
			derivatives2: texture(params.cascades[2].derivative),
			jacobian0: texture(params.cascades[0].jacobian),
			jacobian1: texture(params.cascades[1].jacobian),
			jacobian2: texture(params.cascades[2].jacobian),
			ifft_sampler0: texture(params.cascades[0].derivative),
			ifft_sampler1: texture(params.cascades[1].derivative),
			ifft_sampler2: texture(params.cascades[2].derivative),
			//depthTexture: params.threejs.sceneDepthPassTexture,
			foamStrength: params.foamStrength,
			foamThreshold: params.foamThreshold,
			lodScale: params.lodScale,
			waveLengths: vec4(
				params.cascades[0].params_.lengthScale,
				params.cascades[1].params_.lengthScale,
				params.cascades[2].params_.lengthScale,
			),
			//envTexture: cubeTexture(environmentTexture),
			sunPosition: uniform(params.sunPosition),
			screenCoord: screenUV,
			oceanReflectorColor: params.oceanReflector.context({
				get uv() {
					return screenUV.add(sin(time.mul(10.0).add(screenUV.y.mul(50.0))).mul(0.005));
				}
			})
		}

		this.oceanMaterial = new THREE.MeshBasicNodeMaterial();
		this.oceanMaterial.positionNode = vertexStageWGSL.vertexStageWGSL(wgslShaderParams);
		this.oceanMaterial.colorNode = fragmentStageWGSL(wgslShaderParams);
		this.oceanMaterial.side = THREE.DoubleSide;
		this.oceanMaterial.colorSpace = THREE.SRGBColorSpace;
		this.oceanMaterial.transparent = true;
		this.oceanMaterial.depthWrite = true; // CRÍTICO: Evitar glitches de z-sorting con edificios instanciados
		this.oceanMaterial.opacityNode = wgslShaderParams.opacity;

		// Guardar referencias a los uniforms para acceso externo
		this.renderRadius = wgslShaderParams.renderRadius;
		this.falloffDistance = wgslShaderParams.falloffDistance;
		this.globalOffset = wgslShaderParams.globalOffset;
		this.seaColor = wgslShaderParams.seaColor;
		this.waveColor = wgslShaderParams.waveColor;
		this.skyColor = wgslShaderParams.skyColor;
		this.roughness = wgslShaderParams.roughness;
		this.metallic = wgslShaderParams.metallic;

	}

}


export { OceanMaterial };
