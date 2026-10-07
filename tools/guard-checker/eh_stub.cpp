// The wasm32-wasip1 libc++abi bundled with @yowasp/clang has no unwinder, so
// `throw` would fail to link. Guard.h only throws on malformed LEB128 input;
// turning that into a wasm trap lets the host catch it as a RuntimeError.
extern "C" void* __cxa_allocate_exception(unsigned long) { __builtin_trap(); }
extern "C" void __cxa_throw(void*, void*, void (*)(void*)) { __builtin_trap(); }
