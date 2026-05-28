import { THREE, WebGPU, OrbitControls } from './three-defs.js';
import { entity } from "./entity.js";
import { pass, depthPass } from "three/tsl";



class ThreeJSController extends entity.Component {
	constructor() {
		super();
	}

	InitEntity() {

		if (WebGPU.isAvailable() === false) {
			document.body.appendChild(WebGPU.getErrorMessage());
			throw new Error('Your Browser does not support WebGPU yet');
		}

		this.renderer = new THREE.WebGPURenderer({
			canvas: document.createElement('canvas'),
			antialias: true,
			forceWebGL: false
		});

		this.renderer.outputColorSpace = THREE.SRGBColorSpace;
		this.renderer.setPixelRatio(window.devicePixelRatio);
		this.renderer.shadowMap.enabled = true;
		this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
		this.renderer.physicallyCorrectLights = true;
		this.renderer.domElement.id = 'threejs';


		this.container = document.getElementById('container');
		this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
		this.container.appendChild(this.renderer.domElement);


		const aspect = this.container.clientWidth / this.container.clientHeight;
		const fov = 55;
		const near = 0.1;
		const far = 1E6;
		this.camera = new THREE.PerspectiveCamera(fov, aspect, near, far);
		this.scene = new THREE.Scene();
		this.renderer.setClearColor(0x87CEEB);

		// Sistema de cámara FPS-style personalizado
		this.isRotating = false;
		this.isPanning = false;
		this.previousMousePosition = { x: 0, y: 0 };
		this.rotationSpeed = 0.002;
		this.panSpeed = 0.05;
		this.zoomSpeed = 0.01;

		// Eventos de mouse
		this.renderer.domElement.addEventListener('mousedown', (event) => this.onMouseDown(event));
		this.renderer.domElement.addEventListener('mousemove', (event) => this.onMouseMove(event));
		this.renderer.domElement.addEventListener('mouseup', (event) => this.onMouseUp(event));
		this.renderer.domElement.addEventListener('wheel', (event) => this.onWheel(event));

		// Prevenir menú contextual
		this.renderer.domElement.addEventListener('contextmenu', (event) => event.preventDefault());

		// Configurar posición inicial
		this.camera.position.set(500, 5, 500);
		this.camera.lookAt(0, 0, 0);


		this.postProcessing = new THREE.PostProcessing(this.renderer);

		this.scenePass = pass(this.scene, this.camera);
		this.sceneDepthPass = depthPass(this.scene, this.camera);

		this.scenePassTexture = this.scenePass.getTextureNode();
		this.sceneDepthPassTexture = this.sceneDepthPass.getTextureNode('depth');


		window.addEventListener('resize', () => {
			this.OnResize_();
		}, false);

		// Prevenir comportamiento por defecto del botón derecho en el canvas
		this.renderer.domElement.addEventListener('contextmenu', (event) => {
			event.preventDefault();
		});
	}

	onMouseDown(event) {
		if (event.button === 0) { // Click izquierdo - rotación
			this.isRotating = true;
			this.previousMousePosition = {
				x: event.clientX,
				y: event.clientY
			};
		} else if (event.button === 2) { // Click derecho - pan
			this.isPanning = true;
			this.previousMousePosition = {
				x: event.clientX,
				y: event.clientY
			};
		}
	}

	onMouseMove(event) {
		const deltaX = event.clientX - this.previousMousePosition.x;
		const deltaY = event.clientY - this.previousMousePosition.y;

		if (this.isRotating) {
			// Rotación FPS-style - solo rotación, sin mover posición
			const yawAngle = -deltaX * this.rotationSpeed;
			const pitchAngle = -deltaY * this.rotationSpeed;

			// Rotar alrededor de ejes de cámara
			this.camera.rotateY(yawAngle);
			this.camera.rotateX(pitchAngle);

		} else if (this.isPanning) {
			// Pan - mover cámara en el plano XZ
			const right = new THREE.Vector3();
			const up = new THREE.Vector3(0, 1, 0);

			// Obtener vector derecho de la cámara
			right.set(1, 0, 0);
			right.applyQuaternion(this.camera.quaternion);
			right.y = 0; // Mantener en plano horizontal
			right.normalize();

			// Mover cámara
			const panX = right.multiplyScalar(-deltaX * this.panSpeed);
			const panZ = new THREE.Vector3(0, 0, -deltaY * this.panSpeed);

			this.camera.position.add(panX);
			this.camera.position.add(panZ);
		}

		this.previousMousePosition = {
			x: event.clientX,
			y: event.clientY
		};
	}

	onMouseUp(event) {
		if (event.button === 0) { // Click izquierdo
			this.isRotating = false;
		} else if (event.button === 2) { // Click derecho
			this.isPanning = false;
		}
	}

	onWheel(event) {
		event.preventDefault();
		const zoomDelta = event.deltaY * this.zoomSpeed;

		// Obtener dirección frontal de la cámara
		const forward = new THREE.Vector3(0, 0, -1);
		forward.applyQuaternion(this.camera.quaternion);

		// Mover cámara adelante/atrás
		this.camera.position.add(forward.multiplyScalar(zoomDelta));
	}

	Update() {
		// Sistema de cámara FPS-style - no necesita update de OrbitControls
	}


	OnResize_() {

		const width = this.container.clientWidth;
		const height = this.container.clientHeight;

		this.camera.aspect = width / height;
		this.camera.updateProjectionMatrix();
		this.renderer.setSize(width, height);
	}

}//end class


export default ThreeJSController;
