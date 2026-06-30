/** ARKit blendshape names by standard index, for the jaw+mouth span the
 *  NeuroSync engine emits (indices 14..40 — see yz_body/lipsync/engine.py:
 *  "ARKit standard order: 14 JawForward .. 17 JawOpen .. 40 MouthUpperUpRight").
 *  These names map 1:1 onto a standard ARKit-rigged GLB (e.g. Loom.glb), so a
 *  neurosync frame applies by name with no remapping. */
export const ARKIT_MOUTH_NAME_BY_INDEX: Record<number, string> = {
  14: 'jawForward',
  15: 'jawLeft',
  16: 'jawRight',
  17: 'jawOpen',
  18: 'mouthClose',
  19: 'mouthFunnel',
  20: 'mouthPucker',
  21: 'mouthLeft',
  22: 'mouthRight',
  23: 'mouthSmileLeft',
  24: 'mouthSmileRight',
  25: 'mouthFrownLeft',
  26: 'mouthFrownRight',
  27: 'mouthDimpleLeft',
  28: 'mouthDimpleRight',
  29: 'mouthStretchLeft',
  30: 'mouthStretchRight',
  31: 'mouthRollLower',
  32: 'mouthRollUpper',
  33: 'mouthShrugLower',
  34: 'mouthShrugUpper',
  35: 'mouthPressLeft',
  36: 'mouthPressRight',
  37: 'mouthLowerDownLeft',
  38: 'mouthLowerDownRight',
  39: 'mouthUpperUpLeft',
  40: 'mouthUpperUpRight',
}
