#include "hookapi.h"

int64_t hook(uint32_t reserved)
{
    accept(SBUF("Hello from a browser-compiled Hook"), 0);
    return 0;
}
