// The 3D solver off the UI thread: a full 3D shot takes 0.1–1 s.
import type { Mechanism3 } from './physics3d/model3';
import { simulate3 } from './physics3d/solver3';

onmessage = (e: MessageEvent<{ m3: Mechanism3; opts: Parameters<typeof simulate3>[1] }>) => postMessage(simulate3(e.data.m3, e.data.opts));
