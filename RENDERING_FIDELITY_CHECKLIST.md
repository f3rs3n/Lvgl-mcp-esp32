# LVGL rendering fidelity checklist

The LVGL MCP server is a desktop renderer, not a CoreS3 / ESP32-S3 emulator. Use it as a visual regression and layout sanity tool, not as proof that the physical device will be pixel-perfect.

Before relying on MCP screenshots for firmware decisions, an AI agent should check the items below.

## 1. Confirm what is being rendered

- Identify whether the MCP input is:
  - the real firmware UI code;
  - a shared UI module used by both firmware and simulator;
  - a manually maintained fixture that only imitates the firmware.
- Treat manually maintained fixtures as approximate. They can catch layout regressions, overflow, and missing labels, but they are not proof of pixel-perfect firmware behavior.
- If screenshots differ from the physical device, first compare fixture code vs firmware UI code before suspecting ESP32/ESP32-S3 differences.

## 2. Compare LVGL versions

Check the LVGL version used by:

- the firmware build / PlatformIO environment;
- the MCP simulator build.

Small LVGL version differences can change widget defaults, tabview behavior, font metrics, symbol handling, padding, clipping, scrollbar behavior, and antialiasing.

## 3. Compare `lv_conf.h`

Compare the firmware `lv_conf.h` and simulator `lv_conf.h`, especially:

- `LV_COLOR_DEPTH`
- `LV_DPI_DEF`
- enabled widgets such as `LV_USE_LABEL`, `LV_USE_TABVIEW`, `LV_USE_BAR`, `LV_USE_ARC`
- default theme settings
- font settings
- symbol/font support
- draw backend options

Different LVGL config is one of the most common causes of subtle visual mismatches.

## 4. Check fonts and symbols

If sidebar icons or `LV_SYMBOL_*` glyphs are missing, different, clipped, or replaced by blanks/squares, check fonts first.

Verify:

- the same Montserrat sizes or custom fonts are enabled in firmware and simulator;
- the selected font contains the required LVGL symbols;
- both code paths apply the same font to labels, tab buttons, and nested child labels;
- the fixture has not omitted symbols that the firmware uses.

Missing sidebar icons are usually a font/symbol/config mismatch, not an ESP32-S3 issue.

## 5. Check style application order

LVGL style order matters. Compare whether firmware and fixture apply styles:

- before or after creating tabview/tab buttons;
- to the same object/part/state combinations;
- recursively to generated child labels when needed;
- after tab creation if LVGL creates internal children lazily.

For tabview/sidebar work, confirm styles target the actual tab bar children and that inactive label opacity/color are forced if required.

## 6. Check display geometry and orientation

Confirm both render paths use the same:

- resolution, e.g. `320x240`;
- rotation/orientation;
- sidebar/content dimensions;
- color depth;
- coordinate assumptions;
- safe margins.

The MCP PNG is a desktop image. The physical CoreS3 also goes through M5GFX/LovyanGFX/display-driver behavior, panel brightness/gamma, and flush-buffer constraints.

## 7. Check external renderer limitations

Remember that MCP rendering does not emulate:

- the ESP32-S3 CPU;
- PSRAM pressure;
- DMA/display flush timing;
- M5Unified/M5GFX initialization quirks;
- physical panel gamma/brightness;
- touch hardware;
- real UART/API timing;
- firmware heap fragmentation.

For those, physical CoreS3 testing remains mandatory.

## 8. Define what MCP screenshots are allowed to prove

Good uses:

- layout sanity at 320x240;
- text overflow/clipping detection;
- obvious style regressions;
- widget tree inspection;
- comparing variants quickly;
- checking that labels and cards exist and are in the expected hierarchy.

Not sufficient by itself:

- pixel-perfect sign-off;
- final color/brightness judgment;
- physical readability sign-off;
- performance sign-off;
- proof that ESP32-S3 memory/display-driver behavior is correct.

## 9. Recommended agent workflow before MCP visual review

1. Read the firmware UI source or shared UI module.
2. Read the MCP fixture or render input.
3. State whether the render is exact/shared-code or fixture-based/approximate.
4. Check LVGL version/config/font assumptions if visual differences are being investigated.
5. Run MCP render and inspect both PNG and widget tree.
6. Classify findings as:
   - simulator-confirmed layout issue;
   - likely fixture drift;
   - likely LVGL config/font mismatch;
   - requires physical CoreS3 verification.
7. Do not claim pixel-perfect parity unless the version/config/fonts/code path have been aligned and a physical display check agrees.

## 10. Power Sentinel-specific note

For the Power Sentinel CoreS3 UI, current MCP screenshots are primarily regression aids. They are valuable, but they are not a replacement for flashing the CoreS3 and checking the real HOME/NUT/PVE/HA/M5S tabs on the physical display.

Known areas to double-check when screenshots and live firmware differ:

- sidebar `LV_SYMBOL_*` icons and compact labels;
- inactive sidebar label opacity/color;
- tabview generated child labels;
- exact card padding and text clipping;
- HOME/PVE card density;
- color contrast on the actual CoreS3 display.
