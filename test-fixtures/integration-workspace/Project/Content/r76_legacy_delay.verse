# Config regression (issue #76): an explicit legacy diagnosticDelay is still
# honored while the new autoImportDebounceDelay key is unset.

r76_legacy := class:
    @editable Countdown:float = 5.0
