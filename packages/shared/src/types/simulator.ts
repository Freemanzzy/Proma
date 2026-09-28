/** iOS Simulator preview IPC contract. */
export const SIMULATOR_IPC_CHANNELS = {
  LIST: 'simulator:list', START: 'simulator:start', STOP: 'simulator:stop',
  STATUS: 'simulator:status', HOME: 'simulator:home', SCREENSHOT: 'simulator:screenshot',
  SHUTDOWN: 'simulator:shutdown',
} as const

export interface SimulatorDevice { udid: string; name: string; state: string; runtime: string }
export interface SimulatorPreviewStream { udid: string; booted: boolean }
export interface SimulatorPreviewStatus { running: boolean; udid?: string; url?: string; error?: string; streams?: SimulatorPreviewStream[] }
