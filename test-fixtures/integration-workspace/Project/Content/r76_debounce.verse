# Config regression (issue #76): autoImportDebounceDelay alone governs the
# debounce; the deprecated diagnosticDelay registered default must not win.

r76_device := class:
    var MaybeButton:?button_device = false
