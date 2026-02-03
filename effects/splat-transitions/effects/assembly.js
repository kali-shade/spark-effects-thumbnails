import { SplatMesh, dyno } from "@sparkjsdev/spark";
import * as THREE from "three";
import { getAssetFileURL } from "/examples/js/get-asset-url.js";

export async function init({ THREE: _THREE, scene, camera, renderer, spark }) {
  const group = new THREE.Group();
  scene.add(group);
  let disposed = false;

  // Camera baseline for assembly effect
  camera.position.set(0, 2.2, 9.0);
  camera.lookAt(0, 1.0, 0);

  const PARAMETERS = {
    speedMultiplier: 1.0,
    rotation: true,
    pause: false,
    staySeconds: 2.0,
    transitionSeconds: 4.0,
    scatterRadius: 3.0,
    gridSize: 0.75,
  };

  const time = dyno.dynoFloat(0.0);
  let cameraAngle = 0.0;
  const cameraRadius = 9.0;
  const cameraHeight = 2.2;

  // Two splats for transition
  const splatFiles = [
    "penguin.spz",
    "cat.spz",
  ];

  function assemblyDyno() {
    return new dyno.Dyno({
      inTypes: {
        gsplat: dyno.Gsplat,
        gt: "float",
        objectIndex: "int",
        stay: "float",
        trans: "float",
        numObjects: "int",
        scatterRadius: "float",
        gridSize: "float",
        objectRotation: "vec4",
      },
      outTypes: { gsplat: dyno.Gsplat },
      globals: () => [
        dyno.unindent(`
          // Scalar hash function
          float hashF(vec3 p) { 
            return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); 
          }
          
          // Vector hash using scalar hash
          vec3 hash3(vec3 p) {
            return vec3(
              hashF(p),
              hashF(p + vec3(1.0, 0.0, 0.0)),
              hashF(p + vec3(0.0, 1.0, 0.0))
            );
          }
          
          // 2D rotation matrix
          mat2 rot(float a) {
            float s=sin(a),c=cos(a);
            return mat2(c,-s,s,c);
          }
        `),
      ],
      statements: ({ inputs, outputs }) =>
        dyno.unindentLines(`
        ${outputs.gsplat} = ${inputs.gsplat};
        float stay = ${inputs.stay};
        float trans = ${inputs.trans};
        float cycle = stay + trans;
        float tot = float(${inputs.numObjects}) * cycle;
        float w = mod(${inputs.gt}, tot);
        int cur = int(floor(w / cycle));
        int nxt = (cur + 1) % ${inputs.numObjects};
        float local = mod(w, cycle);
        bool inTrans = local > stay;
        float uPhase = inTrans ? clamp((local - stay) / trans, 0.0, 1.0) : 0.0;
        int idx = ${inputs.objectIndex};
        
        // Cube grid calculation
        vec3 localPos = ${inputs.gsplat}.center;
        vec3 scales = ${inputs.gsplat}.scales;
        float gridSize = ${inputs.gridSize};
        vec3 cellIndex = floor(localPos / gridSize);
        vec3 cellHash = hash3(cellIndex);
        
        // Calculate cell center position
        vec3 cellCenter = cellIndex * gridSize + gridSize * 0.5;
        
        // Calculate scatter position using hash (consistent across both splats)
        // Scatter position is relative to cell center, not localPos, so both splats share same positions
        vec3 scatterOffset = (cellHash - 0.5) * ${inputs.scatterRadius} * 2.0;
        // Rotate scatter offset with object rotation
        scatterOffset = quatVec(${inputs.objectRotation}, scatterOffset);
        vec3 scatterPos = cellCenter + scatterOffset;
        
        // Calculate local position within cell
        vec3 cellLocalPos = localPos - cellCenter;
        
        // Divide transition into two phases
        bool phaseDisassembly = uPhase < 0.5;
        float phaseProgress = phaseDisassembly ? (uPhase / 0.5) : ((uPhase - 0.5) / 0.5);
        float ease = phaseProgress * phaseProgress * (3.0 - 2.0 * phaseProgress);
        
        float alpha = 0.0;
        vec3 finalPos = localPos;
        vec3 finalScales = scales;
        
        if (idx == cur) {
          if (!inTrans) {
            // Current splat: fully assemblyd
            alpha = 1.0;
            finalPos = localPos;
            finalScales = scales;
          } else if (phaseDisassembly) {
            // First half: disassembly current splat, alpha goes from 1.0 to 0.0
            alpha = 1.0 - ease;
            
            // Add rotation during disassembly
            float rotAngle = ease * length(cellHash) * 2.0;
            vec3 rotatedLocalPos = cellLocalPos;
            rotatedLocalPos.xy *= rot(rotAngle * 0.7);
            rotatedLocalPos.xz *= rot(rotAngle * 0.5);
            
            // Interpolate from original position to scatter position with rotation
            finalPos = mix(localPos, scatterPos + rotatedLocalPos, ease);
            finalScales = scales;
          } else {
            // Second half: current splat invisible at scatter position
            alpha = 0.0;
            finalPos = scatterPos;
            finalScales = scales;
          }
        } else if (idx == nxt) {
          if (!inTrans) {
            // Next splat: invisible at scatter position
            alpha = 0.0;
            finalPos = scatterPos;
            finalScales = scales;
          } else if (phaseDisassembly) {
            // First half: next splat invisible at scatter position
            alpha = 0.0;
            finalPos = scatterPos;
            finalScales = scales;
          } else {
            // Second half: reassembly next splat, alpha goes from 0.0 to 1.0
            alpha = ease;
            
            // Add rotation during reassembly (reverse rotation)
            float rotAngle = (1.0 - ease) * length(cellHash) * 2.0;
            vec3 rotatedLocalPos = cellLocalPos;
            rotatedLocalPos.xy *= rot(rotAngle * 0.7);
            rotatedLocalPos.xz *= rot(rotAngle * 0.5);
            
            // Interpolate from scatter position to original position with rotation
            finalPos = mix(scatterPos + rotatedLocalPos, localPos, ease);
            finalScales = scales;
          }
        } else {
          alpha = 0.0;
          finalPos = localPos;
          finalScales = scales;
        }
        
        ${outputs.gsplat}.center = finalPos;
        ${outputs.gsplat}.scales = finalScales;
        ${outputs.gsplat}.rgba.a = ${inputs.gsplat}.rgba.a * alpha;
      `),
    });
  }

  function getassemblyModifier(
    gt,
    idx,
    stay,
    trans,
    numObjects,
    scatterRadius,
    gridSize,
    objectRotation,
  ) {
    const dyn = assemblyDyno();
    return dyno.dynoBlock(
      { gsplat: dyno.Gsplat },
      { gsplat: dyno.Gsplat },
      ({ gsplat }) => ({
        gsplat: dyn.apply({
          gsplat,
          gt,
          objectIndex: idx,
          stay,
          trans,
          numObjects,
          scatterRadius,
          gridSize,
          objectRotation,
        }).gsplat,
      }),
    );
  }

  const meshes = [];
  const numObjectsDyn = dyno.dynoInt(splatFiles.length);
  const stayDyn = dyno.dynoFloat(PARAMETERS.staySeconds);
  const transDyn = dyno.dynoFloat(PARAMETERS.transitionSeconds);
  const scatterRadiusDyn = dyno.dynoFloat(PARAMETERS.scatterRadius);
  const gridSizeDyn = dyno.dynoFloat(PARAMETERS.gridSize);

  for (let i = 0; i < splatFiles.length; i++) {
    const url = await getAssetFileURL(splatFiles[i]);
    const mesh = new SplatMesh({ url });
    await mesh.initialized;
    mesh.rotateX(Math.PI);
    mesh.position.set(0, -3.5, 0);
    mesh.scale.set(1.5, 1.5, 1.5);
    if (!disposed) group.add(mesh);
    meshes.push(mesh);
  }

  // Assign assembly modifiers (cube disassembly/reassembly transition)
  meshes.forEach((m, i) => {
    const objectRotationDyn = dyno.dynoVec4(new THREE.Quaternion());
    m.worldModifier = getassemblyModifier(
      time,
      dyno.dynoInt(i),
      stayDyn,
      transDyn,
      numObjectsDyn,
      scatterRadiusDyn,
      gridSizeDyn,
      objectRotationDyn,
    );
    m.updateGenerator();
    
    // Store rotation dyno for update loop
    m._rotationDyn = objectRotationDyn;
  });

  function update(dt, _t) {
    if (!PARAMETERS.pause) {
      time.value += dt * PARAMETERS.speedMultiplier;
      
      // Orbit camera around splats
      if (PARAMETERS.rotation) {
        cameraAngle += dt * PARAMETERS.speedMultiplier * 0.5;
        camera.position.x = Math.cos(cameraAngle) * cameraRadius;
        camera.position.z = Math.sin(cameraAngle) * cameraRadius;
        camera.position.y = cameraHeight;
        camera.lookAt(0, -1.5, 0);
      }
      
      for (const m of meshes) {
        // Splats remain static, no rotation
        // Update rotation quaternion (static, no rotation applied)
        if (m._rotationDyn) {
          m._rotationDyn.value = m.quaternion;
        }
        m.updateVersion();
      }
    }
  }

  function setupGUI(folder) {
    folder.add(PARAMETERS, "speedMultiplier", 0.1, 3.0, 0.01);
    folder.add(PARAMETERS, "rotation");
    folder.add(PARAMETERS, "pause");
    folder.add(PARAMETERS, "staySeconds", 0.2, 5.0, 0.05).onChange((v) => {
      stayDyn.value = v;
    });
    folder
      .add(PARAMETERS, "transitionSeconds", 1.0, 3.0, 0.05)
      .onChange((v) => {
        transDyn.value = v;
      });
    folder.add(PARAMETERS, "scatterRadius", 1.0, 8.0, 0.1).name("Scatter Radius").onChange((v) => {
      scatterRadiusDyn.value = v;
    });
    folder.add(PARAMETERS, "gridSize", 0.25, 1.5, 0.05).onChange((v) => {
      gridSizeDyn.value = v;
    });
    return folder;
  }

  function dispose() {
    disposed = true;
    scene.remove(group);
  }

  return { group, update, dispose, setupGUI };
}
