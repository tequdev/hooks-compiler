#include "hookapi.h"

int64_t hook(uint32_t reserved)
{
    _g(1, 1);
    accept(SBUF("Hello from a browser-compiled Hook"), 0);
    return 0;
}
