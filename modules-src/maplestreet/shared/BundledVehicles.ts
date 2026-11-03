/**
 * Vehicles that ship with the game instead of being published from the admin
 * editor. They are ordinary `custom:<id>` records (shared/CustomVehicles.ts),
 * so the dealer, garages, fuel and physics treat them exactly like published
 * ones; registerCustomVehicles() always includes them, and a published record
 * with the same id replaces the bundled one.
 *
 * Models live in public/modules/maplestreet/vehicles/. They were made from
 * Meshy image-to-3D scans: reduced to 40k triangles, textures to 1024 px,
 * meshopt-compressed, the baked-in wheels cut out (the game draws its own),
 * and manufacturer badges and lettering painted out. The numbers below come
 * from the vehicle editor's own draft math (src/components/maplestreet/vehicle/
 * draft.ts: newDraft + draftSpec) with the measured axles, wheels and lamps.
 */
import type { CustomVehicleRecord } from './CustomVehicles';

export const BUNDLED_VEHICLES: readonly CustomVehicleRecord[] = [
  {
    id: 'bundled-meridian-sedan',
    name: 'Meridian Sedan',
    template: 'sedan',
    model: {
      scale: 2.578,
      yaw: 180,
      x: -0.006,
      y: 0.088,
      z: -0.001
    },
    physics: {
      chassis: {
        hx: 2.45,
        hy: 0.339,
        hz: 1.128
      },
      mass: 1500,
      comY: -0.398,
      axles: [
        {
          x: 1.613,
          radius: 0.322,
          width: 0.232,
          halfTrack: 0.915,
          steer: true,
          drive: true
        },
        {
          x: -1.316,
          radius: 0.322,
          width: 0.232,
          halfTrack: 0.915,
          steer: false,
          drive: false
        }
      ],
      wheelY: -0.1,
      suspension: {
        rest: 0.319,
        travel: 0.199,
        stiffness: 34,
        compression: 2.6,
        relaxation: 3.4
      },
      frictionSlip: 2.6,
      sideStiffness: 1,
      engineForce: 2966,
      topSpeed: 61.73,
      brake: 46.6,
      maxSteer: 0.5585053606381855,
      seat: {
        x: -0.199,
        y: -0.06,
        z: -0.477
      },
      hitch: null,
      cam: {
        dist: 7.969,
        height: 2.344
      }
    },
    lights: {
      head: [
        {
          x: 2.288,
          y: 0.088,
          z: 0.67
        }
      ],
      tail: [
        {
          x: -2.352,
          y: 0.268,
          z: 0.773
        }
      ]
    },
    paint: {
      mode: 'none',
      material: '',
      key: '#ffffff',
      tolerance: 0.18,
      color: '#e8e8e8'
    },
    targets: {
      topSpeedMph: 72,
      zeroToMph: 60,
      zeroToSeconds: 12
    },
    dealer: {
      forSale: true,
      price: 24500,
      fuel: 'gas',
      tank: 15,
      mpg: 31
    },
    traffic: {
      enabled: false,
      driver: 'Meridian Sedan',
      route: 'ringA',
      mph: 24
    },
    wheelsRemoved: true,
    parts: {
      doors: [{ front: 0.92, back: -0.02, bottom: -0.42, top: 0.66 }, { front: -0.06, back: -1.0, bottom: -0.42, top: 0.64 }],
      hood: { front: 2.4, back: 1.05, bottom: 0.16, top: 0.56 },
      trunk: { front: -1.62, back: -2.46, bottom: 0.36, top: 0.62 },
    },
    modelUrl: '/modules/maplestreet/vehicles/meridian-sedan.glb',
    wheelUrl: null,
    active: true,
    status: 'published',
    updatedAt: 1793664000000
  },
  {
    id: 'bundled-bulwark-4x4',
    name: 'Bulwark 4x4',
    template: 'truck',
    model: {
      scale: 2.553,
      yaw: 180,
      x: -0.008,
      y: 0.299,
      z: -0.001
    },
    physics: {
      chassis: {
        hx: 2.425,
        hy: 0.357,
        hz: 1.183
      },
      mass: 2500,
      comY: -0.426,
      axles: [
        {
          x: 1.55,
          radius: 0.383,
          width: 0.281,
          halfTrack: 0.983,
          steer: true,
          drive: true
        },
        {
          x: -1.425,
          radius: 0.383,
          width: 0.281,
          halfTrack: 0.983,
          steer: false,
          drive: true
        }
      ],
      wheelY: -0.153,
      suspension: {
        rest: 0.357,
        travel: 0.238,
        stiffness: 30,
        compression: 2.4,
        relaxation: 3.2
      },
      frictionSlip: 2.3,
      sideStiffness: 1,
      engineForce: 2632,
      topSpeed: 99.02,
      brake: 79.5,
      maxSteer: 0.5934119456780721,
      seat: {
        x: 0.255,
        y: 0.306,
        z: -0.478
      },
      hitch: {
        x: -2.575,
        y: -0.238
      },
      cam: {
        dist: 8.085,
        height: 2.99
      }
    },
    lights: {
      head: [
        {
          x: 2.277,
          y: 0.171,
          z: 0.664
        }
      ],
      tail: [
        {
          x: -2.203,
          y: 0.044,
          z: 0.74
        }
      ]
    },
    paint: {
      mode: 'none',
      material: '',
      key: '#ffffff',
      tolerance: 0.18,
      color: '#c4161c'
    },
    targets: {
      topSpeedMph: 85,
      zeroToMph: 60,
      zeroToSeconds: 8.5
    },
    dealer: {
      forSale: true,
      price: 68000,
      fuel: 'gas',
      tank: 26,
      mpg: 15
    },
    traffic: {
      enabled: false,
      driver: 'Bulwark 4x4',
      route: 'ringA',
      mph: 24
    },
    wheelsRemoved: true,
    parts: {
      doors: [{ front: 0.86, back: -0.18, bottom: -0.27, top: 1.02 }, { front: -0.24, back: -1.0, bottom: -0.25, top: 1.02 }],
      hood: { front: 2.32, back: 0.95, bottom: 0.34, top: 0.6 },
      trunk: { front: -2.12, back: -2.62, bottom: -0.1, top: 1.08 },
    },
    modelUrl: '/modules/maplestreet/vehicles/bulwark-4x4.glb',
    wheelUrl: null,
    active: true,
    status: 'published',
    updatedAt: 1793664000000
  },
  {
    id: 'bundled-ironhorn-crew-cab',
    name: 'Ironhorn Crew Cab',
    template: 'truck',
    model: {
      scale: 3.053,
      yaw: 180,
      x: -0.006,
      y: 0.116,
      z: 0
    },
    physics: {
      chassis: {
        hx: 2.9,
        hy: 0.427,
        hz: 1.356
      },
      mass: 2350,
      comY: -0.509,
      axles: [
        {
          x: 1.948,
          radius: 0.443,
          width: 0.275,
          halfTrack: 1.053,
          steer: true,
          drive: true
        },
        {
          x: -1.639,
          radius: 0.443,
          width: 0.275,
          halfTrack: 1.053,
          steer: false,
          drive: true
        }
      ],
      wheelY: -0.183,
      suspension: {
        rest: 0.427,
        travel: 0.285,
        stiffness: 30,
        compression: 2.4,
        relaxation: 3.2
      },
      frictionSlip: 2.3,
      sideStiffness: 1,
      engineForce: 2445,
      topSpeed: 72.79,
      brake: 74.8,
      maxSteer: 0.5934119456780721,
      seat: {
        x: 0.305,
        y: 0.366,
        z: -0.547
      },
      hitch: {
        x: -3.05,
        y: -0.285
      },
      cam: {
        dist: 9.668,
        height: 2.915
      }
    },
    lights: {
      head: [
        {
          x: 2.742,
          y: 0.223,
          z: 0.824
        }
      ],
      tail: [
        {
          x: -2.723,
          y: 0.208,
          z: 1.007
        }
      ]
    },
    paint: {
      mode: 'none',
      material: '',
      key: '#ffffff',
      tolerance: 0.18,
      color: '#141414'
    },
    targets: {
      topSpeedMph: 78,
      zeroToMph: 60,
      zeroToSeconds: 10
    },
    dealer: {
      forSale: true,
      price: 38500,
      fuel: 'gas',
      tank: 26,
      mpg: 20
    },
    traffic: {
      enabled: false,
      driver: 'Ironhorn Crew Cab',
      route: 'ringA',
      mph: 24
    },
    wheelsRemoved: true,
    parts: {
      doors: [{ front: 1.25, back: 0.15, bottom: -0.42, top: 1.0 }, { front: 0.1, back: -0.92, bottom: -0.42, top: 1.0 }],
      hood: { front: 2.88, back: 1.55, bottom: 0.38, top: 0.72 },
      trunk: { front: -2.7, back: -2.96, bottom: -0.22, top: 0.54, drop: true },
    },
    modelUrl: '/modules/maplestreet/vehicles/ironhorn-crew-cab.glb',
    wheelUrl: null,
    active: true,
    status: 'published',
    updatedAt: 1793664000000
  },
  {
    id: 'bundled-maple-hauler',
    name: 'Maple Hauler',
    template: 'truck',
    model: {
      scale: 2.72,
      yaw: 180,
      x: -0.003,
      y: 0.016,
      z: -0.001
    },
    physics: {
      chassis: {
        hx: 2.588,
        hy: 0.381,
        hz: 1.048
      },
      mass: 1827,
      comY: -0.454,
      axles: [
        {
          x: 1.752,
          radius: 0.36,
          width: 0.237,
          halfTrack: 0.74,
          steer: true,
          drive: true
        },
        {
          x: -1.363,
          radius: 0.36,
          width: 0.237,
          halfTrack: 0.74,
          steer: false,
          drive: true
        }
      ],
      wheelY: -0.163,
      suspension: {
        rest: 0.381,
        travel: 0.254,
        stiffness: 30,
        compression: 2.4,
        relaxation: 3.2
      },
      frictionSlip: 2.3,
      sideStiffness: 1,
      engineForce: 1945,
      topSpeed: 40.84,
      brake: 58.1,
      maxSteer: 0.5934119456780721,
      seat: {
        x: 0.052,
        y: -0.092,
        z: -0.327
      },
      hitch: {
        x: -2.738,
        y: -0.254
      },
      cam: {
        dist: 8.625,
        height: 2.365
      }
    },
    lights: {
      head: [
        {
          x: 2.527,
          y: -0.079,
          z: 0.572
        }
      ],
      tail: [
        {
          x: -2.532,
          y: 0.071,
          z: 0.735
        }
      ]
    },
    paint: {
      mode: 'color',
      material: '',
      key: '#b20a29',
      tolerance: 0.2,
      color: '#b20a29'
    },
    targets: {
      topSpeedMph: 63,
      zeroToMph: 56,
      zeroToSeconds: 12.2
    },
    dealer: {
      forSale: false,
      price: 0,
      fuel: 'gas',
      tank: 22,
      mpg: 19
    },
    traffic: {
      enabled: false,
      driver: 'Maple Hauler',
      route: 'ringA',
      mph: 24
    },
    wheelsRemoved: true,
    modelUrl: '/modules/maplestreet/vehicles/maple-hauler.glb',
    wheelUrl: null,
    active: true,
    status: 'published',
    updatedAt: 1793664000000
  },
  {
    id: 'bundled-lakeshore-coupe',
    name: 'Lakeshore Coupe',
    template: 'coupe',
    model: {
      scale: 2.42,
      yaw: 180,
      x: -0.001,
      y: 0.133,
      z: -0.001
    },
    physics: {
      chassis: {
        hx: 2.302,
        hy: 0.285,
        hz: 1.105
      },
      mass: 1427,
      comY: -0.401,
      axles: [
        {
          x: 1.305,
          radius: 0.333,
          width: 0.242,
          halfTrack: 0.837,
          steer: true,
          drive: false
        },
        {
          x: -1.32,
          radius: 0.333,
          width: 0.242,
          halfTrack: 0.837,
          steer: false,
          drive: true
        }
      ],
      wheelY: -0.089,
      suspension: {
        rest: 0.267,
        travel: 0.16,
        stiffness: 38,
        compression: 2.8,
        relaxation: 3.6
      },
      frictionSlip: 2.7,
      sideStiffness: 1.05,
      engineForce: 3151,
      topSpeed: 69.99,
      brake: 50.6,
      maxSteer: 0.5061454830783556,
      seat: {
        x: -0.292,
        y: 0.012,
        z: -0.364
      },
      hitch: null,
      cam: {
        dist: 7.57,
        height: 2.144
      }
    },
    lights: {
      head: [
        {
          x: 2.128,
          y: -0.036,
          z: 0.727
        }
      ],
      tail: [
        {
          x: -2.179,
          y: 0.06,
          z: 0.727
        }
      ]
    },
    paint: {
      mode: 'color',
      material: '',
      key: '#c4c5ca',
      tolerance: 0.16,
      color: '#c4c5ca'
    },
    targets: {
      topSpeedMph: 79,
      zeroToMph: 60,
      zeroToSeconds: 9.3
    },
    dealer: {
      forSale: true,
      price: 21500,
      fuel: 'gas',
      tank: 14,
      mpg: 30
    },
    traffic: {
      enabled: true,
      driver: 'Lakeshore Coupe',
      route: 'downtown',
      mph: 24,
      count: 6,
      routes: [
        'downtown',
        'ringA',
        'ringB',
        'downtown',
        'ringA',
        'ringB'
      ],
      colors: [
        '#c4c5ca',
        '#a3161c',
        '#1f4fa8',
        '#1c1d21',
        '#f2f2ee',
        '#2f6b45'
      ]
    },
    wheelsRemoved: true,
    modelUrl: '/modules/maplestreet/vehicles/lakeshore-coupe.glb',
    wheelUrl: null,
    active: true,
    status: 'published',
    updatedAt: 1793664000000
  }
];
