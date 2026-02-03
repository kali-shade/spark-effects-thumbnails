import { SplatMesh, dyno } from "@sparkjsdev/spark";
import * as THREE from "three";
import { getAssetFileURL } from "/examples/js/get-asset-url.js";

export async function init({ THREE: _THREE, scene, camera, renderer, spark }) {
  const group = new THREE.Group();
  scene.add(group);
  let disposed = false;

  // Camera baseline for Morph effect
  camera.position.set(0, 2.2, 6.5);
  camera.lookAt(0, 1.0, 0);

  const PARAMETERS = {
    speedMultiplier: 1.0,
    rotation: true,
    pause: false,
    staySeconds: 1.5,
    transitionSeconds: 2.0,
    randomRadius: 3.0,
  };

  const time = dyno.dynoFloat(0.0);

  // Tres splats de comida
  const splatFiles = [
    "branzino-amarin.spz",
    "pad-thai.spz",
    "primerib-tamos.spz",
  ];

  function morphDyno() {
    return new dyno.Dyno({
      inTypes: {
        gsplat: dyno.Gsplat,
        gt: "float",
        objectIndex: "int",
        stay: "float",
        trans: "float",
        numObjects: "int",
        randomRadius: "float",
        objectRotation: "vec4",
      },
      outTypes: { gsplat: dyno.Gsplat },
      globals: () => [
        dyno.unindent(`
        vec3 hash3(int n) {
          float x = float(n);
          return fract(sin(vec3(x, x + 1.0, x + 2.0)) * 43758.5453123);
        }
        vec3 hash3FromPos(vec3 p) {
          // Hash based on world position for consistent scatter across different splats
          return fract(sin(vec3(
            dot(p, vec3(127.1, 311.7, 74.7)),
            dot(p, vec3(269.5, 183.3, 246.1)),
            dot(p, vec3(419.2, 371.9, 83.7))
          )) * 43758.5453123);
        }
        float ease(float x) { return x*x*(3.0 - 2.0*x); }
        vec3 randPos(int splatIndex, float radius) {
          // Uniform random distribution inside a sphere
          vec3 h = hash3(splatIndex);
          
          // Generate random direction (uniform on sphere surface)
          float theta = 6.28318530718 * h.x; // Azimuthal angle [0, 2π]
          float phi = acos(2.0 * h.y - 1.0); // Polar angle [0, π] for uniform distribution
          
          // Generate random radius with uniform volume distribution
          // For uniform volume: r^3 is uniform, so r = cbrt(uniform)
          float r = radius * pow(h.z, 1.0 / 3.0);
          
          // Convert spherical to cartesian coordinates
          float sinPhi = sin(phi);
          vec3 pos = vec3(
            r * sinPhi * cos(theta),
            r * cos(phi),
            r * sinPhi * sin(theta)
          );
          
          // Flatten sphere in Y to 30% height
          pos.y *= 0.3;
          
          return pos;
        }
        vec3 randPosFromWorldPos(vec3 worldPos, float radius) {
          // Generate scatter position based on world position for consistency across splats
          // Round position to grid for consistent hashing
          vec3 gridPos = floor(worldPos * 5.0) / 5.0;
          vec3 h = hash3FromPos(gridPos);
          float theta = 6.28318530718 * h.x;
          float r = radius * sqrt(h.y);
          return vec3(r * cos(theta), 0.0, r * sin(theta));
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
        bool phaseScatter = uPhase < 0.5;
        float s = phaseScatter ? (uPhase / 0.5) : ((uPhase - 0.5) / 0.5);
        int idx = ${inputs.objectIndex};

        // Calculate world-space scatter position based on gsplat index
        // Using gsplat index ensures consistent scatter positions across different splats
        // All splats will have gsplats at same indices going to same scatter positions
        vec3 rp = randPos(int(${inputs.gsplat}.index), ${inputs.randomRadius});
        
        // Rotate scatter position with object rotation
        vec3 rpRotated = quatVec(${inputs.objectRotation}, rp);
        
        // rpMid is in world space coordinates (common for all splats)
        // rp already includes height variation, add base height offset
        float baseHeight = 0.5;
        rpRotated.y += baseHeight;
        vec3 worldCenter = vec3(0.0, baseHeight, 0.0);
        vec3 rpMid = mix(worldCenter, rpRotated, 0.7);

        float alpha = 0.0;
        vec3 pos = ${inputs.gsplat}.center;
        vec3 origScale = ${inputs.gsplat}.scales;
        vec3 small = vec3(.03);
        
        if (idx == cur) {
          if (!inTrans) {
            alpha = 1.0;
            pos = ${inputs.gsplat}.center;
            ${outputs.gsplat}.scales = origScale;
          } else if (phaseScatter) {
            alpha = 1.0 - ease(s)*.5;
            pos = mix(${inputs.gsplat}.center, rpMid, ease(s));
            ${outputs.gsplat}.scales = mix(origScale, small, ease(s));
          } else {
            alpha = 0.0;
            pos = rpMid;
            ${outputs.gsplat}.scales = small;
          }
        } else if (idx == nxt) {
          if (!inTrans) {
            alpha = 0.0;
            pos = rpMid;
            ${outputs.gsplat}.scales = small;
          } else if (phaseScatter) {
            alpha = 0.0;
            pos = rpMid;
            ${outputs.gsplat}.scales = small;
          } else {
            alpha = 1.0;
            pos = mix(rpMid, ${inputs.gsplat}.center, ease(s));
            ${outputs.gsplat}.scales = mix(small, origScale, ease(s));
          }
        } else {
          alpha = 0.0;
          pos = ${inputs.gsplat}.center;
          ${outputs.gsplat}.scales = origScale;
        }
        
        ${outputs.gsplat}.center = pos;
        ${outputs.gsplat}.rgba.a = ${inputs.gsplat}.rgba.a * alpha;
      `),
    });
  }

  function getMorphModifier(
    gt,
    idx,
    stay,
    trans,
    numObjects,
    randomRadius,
    objectRotation,
  ) {
    const dyn = morphDyno();
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
          randomRadius,
          objectRotation,
        }).gsplat,
      }),
    );
  }

  const meshes = [];
  const numObjectsDyn = dyno.dynoInt(splatFiles.length);
  const stayDyn = dyno.dynoFloat(PARAMETERS.staySeconds);
  const transDyn = dyno.dynoFloat(PARAMETERS.transitionSeconds);
  const radiusDyn = dyno.dynoFloat(PARAMETERS.randomRadius);
  const OFFSETS_Y = [
    dyno.dynoFloat(0.0),
    dyno.dynoFloat(0.3),
    dyno.dynoFloat(0.0),
  ];

  for (let i = 0; i < splatFiles.length; i++) {
    const url = await getAssetFileURL(splatFiles[i]);
    const mesh = new SplatMesh({ url });
    await mesh.initialized;
    // Orientación base similar a otros efectos
    mesh.rotateX(Math.PI);
    mesh.position.set(0, 0, 0);
    mesh.scale.set(1.5, 1.5, 1.5);
    if (!disposed) group.add(mesh);
    meshes.push(mesh);
  }

  // Asignar modificadores de morph (hold → scatter → morph)
  meshes.forEach((m, i) => {
    const objectRotationDyn = dyno.dynoVec4(new THREE.Quaternion());
    m.worldModifier = getMorphModifier(
      time,
      dyno.dynoInt(i),
      stayDyn,
      transDyn,
      numObjectsDyn,
      radiusDyn,
      objectRotationDyn,
    );
    m.updateGenerator();
    
    // Update rotation dyno in update loop
    m._rotationDyn = objectRotationDyn;
  });

  function update(dt, _t) {
    if (!PARAMETERS.pause) {
      time.value += dt * PARAMETERS.speedMultiplier;
      for (const m of meshes) {
        if (PARAMETERS.rotation) {
          m.rotation.y += dt * PARAMETERS.speedMultiplier;
        }
        // Update rotation quaternion for scatter cloud rotation
        if (m._rotationDyn) {
          m._rotationDyn.value = m.quaternion;
        }
        // Ensure dyno uniform updates are applied even without rotation
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
    return folder;
  }

  function dispose() {
    disposed = true;
    scene.remove(group);
  }

  return { group, update, dispose, setupGUI };
}
