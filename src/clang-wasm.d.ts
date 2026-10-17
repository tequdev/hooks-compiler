declare module "@live-codes/clang-wasm/toolchain" {
  type Memfs = {
    hasFile(path: string): boolean;
    setFile(path: string, bytes: Uint8Array): void;
    addDirectory(path: string): void;
    getFileContents(path: string): Uint8Array;
  };
  export type Toolchain = {
    runtime: {
      memfs: Memfs;
      getModule(url: string): Promise<WebAssembly.Module>;
      assetUrls: { clang: string; lld: string };
      run(module: WebAssembly.Module, ...args: unknown[]): Promise<unknown>;
    };
    addFile(path: string, contents: string | Uint8Array): void;
    lock<T>(work: () => Promise<T>): Promise<T>;
    captureCompilerOutput<T>(work: () => Promise<T>): Promise<{ result: T; raw: string; error: Error | null }>;
  };
  export function createToolchain(options?: { baseUrl?: string | URL; onProgress?: (fraction: number) => void }): Promise<Toolchain>;
  export function compilerDiagnostics(raw: string): string[];
}
