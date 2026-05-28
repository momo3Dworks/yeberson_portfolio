import { wgslFn } from "three/tsl";


export const fragmentStageWGSL = wgslFn(`

    fn WGSLColor(
        cameraPosition: vec3<f32>,
        position: vec3<f32>,
        oceanSize: f32,
        minLodRadius: f32,
        numLayers: f32,
        gridResolution: f32,
        renderRadius: f32,
        falloffDistance: f32,
        seaColor: vec3<f32>,
        waveColor: vec3<f32>,
        skyColor: vec3<f32>,
        shipPosition: vec3<f32>,
        shipSpeed: f32,
        roughness: f32,
        metallic: f32,
        vindex: i32,
        width: f32,
        lod: f32,
        time: f32,
        globalOffset: vec2<f32>,
        derivatives0: texture_2d<f32>,
        derivatives1: texture_2d<f32>,
        derivatives2: texture_2d<f32>,
        jacobian0: texture_2d<f32>, 
        jacobian1: texture_2d<f32>,
        jacobian2: texture_2d<f32>,
        ifft_sampler0: sampler,
        ifft_sampler1: sampler,
        ifft_sampler2: sampler,
        waveLengths: vec4<f32>,
        ifftResolution: f32,
        foamStrength: f32,
        foamThreshold: f32,
        vMorphedPosition: vec3<f32>,
        vDisplacedPosition: vec3<f32>,
        vCascadeScales: vec4<f32>,
        vTexelCoord0: vec2<f32>,
        vTexelCoord1: vec2<f32>,
        vTexelCoord2: vec2<f32>,
        sunPosition: vec3<f32>,
        screenCoord: vec2<f32>,
        oceanReflectorColor: vec4<f32>,
    ) -> vec4<f32> {

        var vViewVector = vDisplacedPosition - cameraPosition;
        var vViewDist = length(vViewVector);
        var viewDir = normalize(vViewVector);

        // Distance culling with circular falloff
        var horizontalDistance = length(vDisplacedPosition.xz - cameraPosition.xz);
        var distanceAlpha = 1.0;
        
        if (horizontalDistance > renderRadius) {
            distanceAlpha = 0.0;
        } else if (horizontalDistance > renderRadius - falloffDistance) {
            var falloffFactor = (horizontalDistance - (renderRadius - falloffDistance)) / falloffDistance;
            distanceAlpha = 1.0 - falloffFactor;
        }

        var samplePos: vec2<f32> = vMorphedPosition.xz + globalOffset;

        var Normal_0: vec4<f32> = textureSample(derivatives0, ifft_sampler0, (samplePos/waveLengths.x)) * vCascadeScales.x;
        var Normal_1: vec4<f32> = textureSample(derivatives1, ifft_sampler1, (samplePos/waveLengths.y)) * vCascadeScales.y;
        var Normal_2: vec4<f32> = textureSample(derivatives2, ifft_sampler2, (samplePos/waveLengths.z)) * vCascadeScales.z;

        var jacobi0: f32 = textureSample(jacobian0, ifft_sampler0, (samplePos/waveLengths.x)).x;
        var jacobi1: f32 = textureSample(jacobian1, ifft_sampler1, (samplePos/waveLengths.y)).x;
        var jacobi2: f32 = textureSample(jacobian2, ifft_sampler2, (samplePos/waveLengths.z)).x;
        
        var derivatives: vec4<f32> = normalize(Normal_0 + Normal_1 + Normal_2 );
        var slope: vec2<f32> = vec2<f32>(derivatives.x / (1.0 + derivatives.z), derivatives.y / (1.0 + derivatives.w));
        var normalOcean: vec3<f32> = normalize(vec3(-slope.x, 1.0, -slope.y));

        var jakobian: f32 = jacobi0 + jacobi1 + jacobi2;

        // --- Wake Calculation ---
        // Ship is in world space, and we compare it with vMorphedPosition (vertex world space before displacement).
        // Since the ship generally moves by having the ocean scroll backwards (globalOffset),
        // the ship points towards -Z, and the wake trails off into +Z relative to the ship.
        var toShip = vMorphedPosition.xz - shipPosition.xz;
        var wakeZ = toShip.y; // +Z is behind the ship
        var wakeX = toShip.x; // Lateral distance
        
        var wakeIntensity = 0.0;
        var wakeHeight = 0.0;

        // ── HEIGHT GATE ──────────────────────────────────────────────────────────
        // Wake/foam only activates when the ship is close to the ocean surface.
        // smoothstep(highY, lowY, shipY): 0.0 when ship is high (≥10), 1.0 when low (≤2).
        // TWEAK: raise 10.0 to activate earlier, lower 2.0 to require closer proximity.
        var heightFactor = smoothstep(1.3, 0.02, shipPosition.y);
        
        if (heightFactor > 0.001 && wakeZ > 0.0 && wakeZ < 150.0) {
            var wakeWidth = wakeZ * 0.45; // V-shape half-angle
            var distToEdge = abs(abs(wakeX) - wakeWidth);
            
            // Wider soft edge (8.0) = smoother, less blocky V-arms
            var edgeIntensity = smoothstep(8.0, 0.0, distToEdge);
            var centerIntensity = smoothstep(wakeWidth * 0.8, 0.0, abs(wakeX)) * smoothstep(150.0, 0.0, wakeZ);
            
            wakeIntensity = max(edgeIntensity, centerIntensity * 0.5);
            
            // ── SMOOTH VALUE NOISE (replaces blocky floor-quantized noise) ────────
            // Bilinear interpolation between 4 random lattice points → smooth organic edges
            var noiseCoord1 = samplePos * 0.18 + vec2<f32>(time * 0.04, 0.0);
            var noiseCoord2 = samplePos * 0.55 + vec2<f32>(0.0, time * 0.025);
            var i1 = floor(noiseCoord1); var f1 = fract(noiseCoord1);
            var i2 = floor(noiseCoord2); var f2 = fract(noiseCoord2);
            // Smooth Hermite interpolation (matches cubic ease)
            var u1 = f1 * f1 * (3.0 - 2.0 * f1);
            var u2 = f2 * f2 * (3.0 - 2.0 * f2);
            var smoothNoise1 = mix(
                mix(random(i1), random(i1 + vec2<f32>(1.0, 0.0)), u1.x),
                mix(random(i1 + vec2<f32>(0.0, 1.0)), random(i1 + vec2<f32>(1.0, 1.0)), u1.x),
                u1.y
            );
            var smoothNoise2 = mix(
                mix(random(i2), random(i2 + vec2<f32>(1.0, 0.0)), u2.x),
                mix(random(i2 + vec2<f32>(0.0, 1.0)), random(i2 + vec2<f32>(1.0, 1.0)), u2.x),
                u2.y
            );
            // Blend two noise octaves for richer texture
            var wakeNoise = mix(smoothNoise1, smoothNoise2, 0.45) * 1.8;
            wakeIntensity *= wakeNoise;
            
            // ── FADE-IN near the ship (eliminates the hard pop at wakeZ ≈ 0) ─────
            // Foam grows gradually from 0 → full over the first 25 units behind the ship.
            // TWEAK: raise 25.0 to stretch the birth zone further back.
            var birthFade = smoothstep(0.0, 25.0, wakeZ);
            wakeIntensity *= birthFade;
            
            // Fade out based on distance behind ship (far end)
            wakeIntensity *= smoothstep(150.0, 10.0, wakeZ);
            
            // ── INTENSITY: driven ONLY by height, not by cursor speed ─────────────
            // TWEAK: multiply heightFactor by a scalar to boost/reduce overall foam.
            // Default 1.0 = natural. Try 1.5 for heavier foam trail.
            wakeIntensity *= heightFactor * 0.5;
            wakeHeight = wakeIntensity * 0.8;
        }
        
        // Combine natural foam with wake foam
        var foam_mix_factor: f32 = min(1.0, max(0.0, (-jakobian + foamThreshold) * foamStrength + wakeIntensity));

        if(dot(normalOcean, -viewDir) < 0.0){
            normalOcean *= -1.0;
        }

        // Perturb normal with wake
        if (wakeIntensity > 0.1) {
            var wakeNormal = normalize(vec3<f32>(sin(samplePos.x * 2.0), 1.0, cos(samplePos.y * 2.0)));
            normalOcean = normalize(mix(normalOcean, wakeNormal, wakeIntensity * 0.5));
        }

        //----------------------------------------------------------------------------------------------------------------



        //var sunDir: vec3<f32> = normalize(vec3<f32>(-0.4, 0.03, -1));
        var sunDir: vec3<f32> = normalize(sunPosition);

        //var diffuse = diffuseLight(normalOcean, sunDir, 1, 1);
        var fresnel = fresnelSchlick(roughness, normalOcean, -viewDir, 5);
        var specular = specularLight2(normalOcean, sunDir, viewDir, 8) * 1.3;

        //var skyColor = getSkyColor(reflect(normalOcean, viewDir)) * SKYCOLOR * 1.25;

        var R = reflect(-viewDir, normalOcean);

        var halfVec = (normalize(-viewDir + normalOcean));

        R = halfVec;
        R = vec3<f32>(R.y, R.x, R.z);
        R.z *= -1;


        var texcoord = normalize(vec3<f32>(R.x, R.y, R.z));

        var reflectionColor = mix(skyColor, oceanReflectorColor.rgb, 0.95);
        
        var refractionColor = seaColor;
        var waterColor = mix(refractionColor, reflectionColor, fresnel);

        var atten: f32 = max(1.0 - vViewDist * vViewDist * 0.001, 0.0);
        waterColor += waveColor * saturate(vDisplacedPosition.y - 0.0) * 0.05 * atten;

        var oceanColor = waterColor;


        oceanColor += normalize(vec3<f32>(5, 4.5, 4)) * specular;
        //oceanColor += normalize(vec3<f32>(5, 4, 3)) * specular;
        
        oceanColor = mix(oceanColor, vec3<f32>(1), foam_mix_factor);

        oceanColor = mix(seaColor, oceanColor, vCascadeScales.x);


        // Since the mipmaps quickly deplete over distance, a fog at that distance is necessary to avoid unsightly jitter. 
        // This could, of course, be avoided by using longer wavelengths, which would, however, make the ocean very coarse at close range. 
        // A sliding wavelength array for the three cascades would be a good solution. I'll test that out.

        let fade = smoothstep( 500.0, 4000.0, vViewDist );
        var finalColor = mix( oceanColor, vec3<f32>( 0.0, 0.1, 0.2 ), fade );
        
        // Apply distance culling alpha
        finalColor = finalColor * distanceAlpha;
        
        return vec4<f32>( finalColor, distanceAlpha );

    }


 
    const SKYCOLOR: vec3<f32> = vec3<f32>(0.196, 0.588, 0.785);
    const SEACOLOR: vec3<f32> = vec3<f32>(0.004, 0.016, 0.047);
    const WAVECOLOR: vec3<f32> = vec3<f32>(0.14, 0.25, 0.18);

    //var shallowColor = vec3<f32>(0.0, 0.729, 0.988);
    //var deepColor = vec3<f32>(0.004, 0.016, 0.047);
    //var diffuseColor = vec3<f32>(0.014, 0.026, 0.047);



    fn customTextureSample(texture: texture_2d<f32>, sampler: sampler, uv: vec2<f32>) -> vec4<f32> {

        var textureSize: f32 = 512;
        var mip_bias: f32 = 0;
        var maxAnisotropy: f32 = 16;
        var maxMipLevel = log2(textureSize);

        var dx = dpdx(uv * textureSize);
        var dy = dpdy(uv * textureSize);

        
        var Pmax = max(dot(dx, dx), dot(dy, dy));
        var Pmin = min(dot(dx, dx), dot(dy, dy));

        var anisotropicTerm = maxAnisotropy * maxAnisotropy;
        //var Pmin = min(dot(dx, dx) + anisotropicTerm * dot(dy, dy), dot(dy, dy) + anisotropicTerm * dot(dx, dx));

        var roundedRatio = ceil(Pmax/Pmin);
        var clampedRatio = min(roundedRatio, pow(maxAnisotropy, 2));

        var mipmapLevel = min(0.5 * log2(Pmax/clampedRatio) + mip_bias, 7);


        var Normal: vec4<f32> = textureSampleLevel(texture, sampler, uv, mipmapLevel);


        return Normal;
        //return vec4<f32>(1-mipmapLevel, 0, mipmapLevel, 1);
    }


    
    fn getSkyColor(rayDir: vec3<f32>) -> vec3<f32> {
        return mix(vec3(1), mix(SKYCOLOR, 0.2 * SKYCOLOR, rayDir.y), smoothstep(-0.5, 0.25, rayDir.y));
    }


    fn saturate(value: f32) -> f32 {
       return max(0, min(value, 1)); 
    }


    fn diffuseLight(N: vec3<f32>, L: vec3<f32>, strength: f32, e: f32) -> f32 {
        return pow(dot(N, L) * strength + (1 - strength), e);
    }


    fn specularLight(N: vec3<f32>, L: vec3<f32>, V: vec3<f32>, e: f32) -> f32 {
        var specularTerm: f32 = 0;

        //+ vec3<f32>(0,10,0)

        var R = reflect(N , L);
        var nrm: f32 = (e + 8.0) / (3.1415 * 8.0);
        specularTerm = pow(max(dot(R, V), 0), e) * nrm;

        return specularTerm;
    }


    fn specularLight2(N: vec3<f32>, L: vec3<f32>, V: vec3<f32>, e: f32) -> f32 {

        var half_vector = normalize(V - L);
        var specular = pow(max(dot(N, half_vector), 0), e);

        return specular;
    }



    
    fn fresnelSchlick(F: f32, N: vec3<f32>, V: vec3<f32>, exp: f32) -> f32 {
        return F + (1 - F) * pow(saturate(1 - dot(N, V)), exp);
    }


    fn HDR(color: vec3<f32>, e: f32) -> vec3<f32> {
        return (vec3<f32>(1) - exp(-color * e));
    }


    fn findNearestTexelsAndInterpolate(texture: texture_2d<f32>, position: vec2<f32>, size: f32) -> vec4<f32> {

        var weights: vec2<f32> = abs(fract(position));

        var texCoord0 = floor(position) % size;
        var texCoord1 = vec2<f32>(ceil(position.x), floor(position.y)) % size;
        var texCoord2 = vec2<f32>(floor(position.x), ceil(position.y)) % size;
        var texCoord3 = ceil(position) % size;

        var offset = size - 1;

        if(texCoord0.x < 0){texCoord0.x = offset + texCoord0.x;}
        if(texCoord0.y < 0){texCoord0.y = offset + texCoord0.y;}
        if(texCoord1.x < 0){texCoord1.x = offset + texCoord1.x;}
        if(texCoord1.y < 0){texCoord1.y = offset + texCoord1.y;}
        if(texCoord2.x < 0){texCoord2.x = offset + texCoord2.x;}
        if(texCoord2.y < 0){texCoord2.y = offset + texCoord2.y;}
        if(texCoord3.x < 0){texCoord3.x = offset + texCoord3.x;}
        if(texCoord3.y < 0){texCoord3.y = offset + texCoord3.y;}


        var lodlevel = 0;

        var texel0 = textureLoad(texture, vec2<i32>(texCoord0), lodlevel);
        var texel1 = textureLoad(texture, vec2<i32>(texCoord1), lodlevel);
        var texel2 = textureLoad(texture, vec2<i32>(texCoord2), lodlevel);
        var texel3 = textureLoad(texture, vec2<i32>(texCoord3), lodlevel);


        var interp1 = mix(texel0, texel1, weights.x);
        var interp2 = mix(texel2, texel3, weights.x);
        var interpolatedValue = mix(interp1, interp2, weights.y);

        return interpolatedValue;
    }   




    fn sumV(v: vec3<f32>) -> f32 {
        return v.x + v.y + v.z;
    }


    fn random(par: vec2<f32>) -> f32 {
        return fract(sin(dot(par, vec2<f32>(12.9898, 78.233))) * 43758.5453);
    }

`);
