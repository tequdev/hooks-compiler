// Minimal wasi_snapshot_preview1 shim for the C/C++ reactor tools (hook-cleaner).
const EBADF = 8;

export type Reactor = {
  exports: {
    memory: WebAssembly.Memory;
    malloc(n: number): number;
    cleaner(input: number, output: number, lenPtr: number): number;
    _initialize(): void;
  };
  output(): string;
};

export function instantiateReactor(module: WebAssembly.Module): Reactor {
  const dec = new TextDecoder();
  let out = "";
  let mem!: WebAssembly.Memory;
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
    fd_seek: () => EBADF,
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
