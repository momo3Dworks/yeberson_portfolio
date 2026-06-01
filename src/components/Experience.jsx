import React, { Suspense, useMemo } from 'react';
import { reflector } from 'three/tsl';
import Ocean from '../utils/ThreejsWebGPU_IFFT-Ocean/Ocean.jsx';

export default function Experience({ sharedHUD, oceanConfig, onLoaded, registerTransition }) {
  const oceanReflector = useMemo(() => reflector({ resolutionScale: 1, generateMipmaps: true }), []);

  return (
    <Suspense fallback={null}>
      <primitive object={oceanReflector.target} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} visible={false} />
      <Ocean sharedHUD={sharedHUD} oceanConfig={oceanConfig} oceanReflector={oceanReflector} onLoaded={onLoaded} registerTransition={registerTransition} />
    </Suspense>
  );
}
