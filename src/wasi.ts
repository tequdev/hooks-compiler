// Minimal wasi_snapshot_preview1 shim for the C/C++ reactor tools (hook-cleaner, guard-checker).
const EBADF = 8;

export type Reactor = { exports: Record<string, any> & { memory: WebAssembly.Memory }; output(): string };

export function instantiateReactor(module: WebAssembly.Module): Reactor {
  const dec = new TextDecoder();
  let out = "";
  let mem!: WebAssembly.Memory;
  const bad = () => EBADF;
  const wasi = {
    fd_write(_fd: number, iovs: number, iovsLen: number, nwritten: number) {
      const dv = new DataView(mem.buffer);
      let total = 0;
      for (let i = 0; i < iovsLen; i++) {
        const ptr = dv.getUint32(iovs + i * 8, true);
        const len = dv.getUint32(iovs + i * 8 + 4, true);
        out += dec.decode(new Uint8Array(mem.buffer, ptr, len), { stream: true });
        total += len;
      }
      dv.setUint32(nwritten, total, true);
      return 0;
    },
    environ_sizes_get(count: number, size: number) {
      const dv = new DataView(mem.buffer);
      dv.setUint32(count, 0, true);
      dv.setUint32(size, 0, true);
      return 0;
    },
    environ_get: () => 0,
    fd_prestat_get: bad,
    fd_fdstat_get: bad,
    fd_close: bad,
    fd_seek: bad,
    fd_prestat_dir_name: bad,
    proc_exit(code: number): never {
      throw new Error(`proc_exit(${code})`);
    },
  };
  const instance = new WebAssembly.Instance(module, { wasi_snapshot_preview1: wasi });
  const exports = instance.exports as Reactor["exports"];
  mem = exports.memory;
  exports._initialize();
  return { exports, output: () => out };
}
