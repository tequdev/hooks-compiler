//! Post-processes a freshly linked Hook module.
//!
//! Current passes (see README "Current limitations"): parse + validate,
//! require a `hook` function export, drop every custom section
//! (`name`, `producers`, `target_features`, ...). Later Xahau-specific
//! passes (cleaner, flatten/unnest, guard checking) belong in [`process`].

use wasm_encoder::reencode::{Error, Reencode};
use wasmparser::{CustomSectionReader, ExternalKind, Parser, Payload, Validator};

/// Round-trip re-encoder that drops every custom section.
struct StripCustom;

impl Reencode for StripCustom {
    type Error = core::convert::Infallible;

    fn parse_custom_section(
        &mut self,
        _module: &mut wasm_encoder::Module,
        _section: CustomSectionReader<'_>,
    ) -> Result<(), Error<Self::Error>> {
        Ok(())
    }
}

/// Processes `input` and returns the final Hook module bytes.
pub fn process(input: &[u8]) -> Result<Vec<u8>, String> {
    Validator::new()
        .validate_all(input)
        .map_err(|e| format!("invalid wasm: {e}"))?;

    let (_, exports) = imports_exports(input)?;
    if !exports.iter().any(|e| e == "hook") {
        return Err("module does not export a `hook` function".into());
    }

    let mut module = wasm_encoder::Module::new();
    StripCustom
        .parse_core_module(&mut module, Parser::new(0), input)
        .map_err(|e| e.to_string())?;
    Ok(module.finish())
}

/// Lists `"module.name"` imports and export names, in module order.
pub fn imports_exports(input: &[u8]) -> Result<(Vec<String>, Vec<String>), String> {
    let (mut imports, mut exports) = (Vec::new(), Vec::new());
    for payload in Parser::new(0).parse_all(input) {
        match payload.map_err(|e| e.to_string())? {
            Payload::ImportSection(s) => {
                for i in s.into_imports() {
                    let i = i.map_err(|e| e.to_string())?;
                    imports.push(format!("{}.{}", i.module, i.name));
                }
            }
            Payload::ExportSection(s) => {
                for e in s {
                    let e = e.map_err(|e| e.to_string())?;
                    if e.kind == ExternalKind::Func || e.name != "hook" {
                        exports.push(e.name.to_string());
                    }
                }
            }
            _ => {}
        }
    }
    Ok((imports, exports))
}

// --- Raw wasm ABI (no wasm-bindgen). The JS side: alloc(len) -> ptr, copy
// input, call process_raw(ptr, len) -> packed result, read via
// result_ptr/result_len, then free_result(). Single-threaded, one result at a time.
mod ffi {
    use std::alloc::{alloc, dealloc, Layout};
    static mut RESULT: Vec<u8> = Vec::new();
    static mut RESULT_OK: bool = false;

    #[no_mangle]
    pub extern "C" fn alloc_bytes(len: usize) -> *mut u8 {
        unsafe { alloc(Layout::from_size_align_unchecked(len.max(1), 1)) }
    }

    #[no_mangle]
    pub extern "C" fn free_bytes(ptr: *mut u8, len: usize) {
        unsafe { dealloc(ptr, Layout::from_size_align_unchecked(len.max(1), 1)) }
    }

    /// Returns 1 on success, 0 on error. The payload is a joined string on error,
    /// wasm bytes on success for `process`, or `imports\0exports` lists for `info`.
    #[no_mangle]
    pub extern "C" fn process_raw(ptr: *const u8, len: usize) -> u32 {
        let input = unsafe { std::slice::from_raw_parts(ptr, len) };
        store(super::process(input))
    }

    #[no_mangle]
    pub extern "C" fn wat_raw(ptr: *const u8, len: usize) -> u32 {
        let input = unsafe { std::slice::from_raw_parts(ptr, len) };
        store(wasmprinter::print_bytes(input).map(String::into_bytes).map_err(|e| e.to_string()))
    }

    #[no_mangle]
    pub extern "C" fn info_raw(ptr: *const u8, len: usize) -> u32 {
        let input = unsafe { std::slice::from_raw_parts(ptr, len) };
        store(super::imports_exports(input).map(|(i, e)| {
            format!("{}\0{}", i.join("\n"), e.join("\n")).into_bytes()
        }))
    }

    fn store(r: Result<Vec<u8>, String>) -> u32 {
        unsafe {
            RESULT_OK = r.is_ok();
            RESULT = r.unwrap_or_else(|e| e.into_bytes());
            RESULT_OK as u32
        }
    }

    #[no_mangle]
    pub extern "C" fn result_ptr() -> *const u8 {
        unsafe { (*std::ptr::addr_of!(RESULT)).as_ptr() }
    }

    #[no_mangle]
    pub extern "C" fn result_len() -> usize {
        unsafe { (*std::ptr::addr_of!(RESULT)).len() }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_custom_sections_and_checks_hook() {
        let wat = r#"(module
            (import "env" "_g" (func (param i32 i32) (result i32)))
            (import "env" "accept" (func (param i32 i32 i64) (result i64)))
            (memory 2) (export "memory" (memory 0))
            (func $hook (param i32) (result i64) i64.const 0)
            (export "hook" (func $hook))
            (@custom "producers" "junk"))"#;
        let input = wat::parse_str(wat).unwrap();
        let out = process(&input).unwrap();
        assert!(out.len() < input.len());
        assert_eq!(process(&out).unwrap(), out, "idempotent");
        let (i, e) = imports_exports(&out).unwrap();
        assert_eq!(i, ["env._g", "env.accept"]);
        assert_eq!(e, ["memory", "hook"]);
        assert!(process(&wat::parse_str("(module)").unwrap()).unwrap_err().contains("hook"));
        assert!(process(b"nope").unwrap_err().contains("invalid"));
    }
}
