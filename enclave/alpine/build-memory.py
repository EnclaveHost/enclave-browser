#!/usr/bin/env python3
"""Bound Rust link memory without disabling optimization or binary policy checks."""
from pathlib import Path
p = Path('config/makefiles/rust.mk')
s = p.read_text()
replacements = {
    'cargo_rustc_flags += -Clto$(if $(filter full,$(MOZ_LTO_RUST_CROSS)),=fat)':
        'cargo_rustc_flags += -Clto=thin',
    '$(TARGET_RECIPES) $(HOST_RECIPES): RUSTFLAGS += -C codegen-units=1':
        '$(TARGET_RECIPES) $(HOST_RECIPES): RUSTFLAGS += -C codegen-units=16',
    '$(filter -Clto,$(cargo_rustc_flags))':
        '$(filter -Clto -Clto=thin,$(cargo_rustc_flags))',
}
for before, after in replacements.items():
    assert s.count(before) == 1, before
    s = s.replace(before, after)
p.write_text(s)
