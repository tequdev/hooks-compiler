/**
 * Minimal Xahau Hook API subset for the browser-compiler PoC.
 *
 * Declarations are copied verbatim from xahaud `hook/extern.h` and
 * `hook/macro.h` (https://github.com/Xahau/xahaud). Only what the bundled
 * example needs is vendored here.
 */
#ifndef HOOKAPI_INCLUDED
#define HOOKAPI_INCLUDED 1

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

extern int32_t __attribute__((noduplicate))
_g(uint32_t guard_id, uint32_t maxiter);

extern int64_t
accept(uint32_t read_ptr, uint32_t read_len, int64_t error_code);

extern int64_t
rollback(uint32_t read_ptr, uint32_t read_len, int64_t error_code);

#ifdef __cplusplus
}
#endif

// hook developers should use this guard macro, simply GUARD(<maximum iterations>)
#define GUARD(maxiter) _g((1ULL << 31U) + __LINE__, (maxiter)+1)
#define GUARDM(maxiter, n) _g(( (1ULL << 31U) + (__LINE__ << 16) + n), (maxiter)+1)

#define SBUF(str) (uint32_t)(str), sizeof(str)

#endif
