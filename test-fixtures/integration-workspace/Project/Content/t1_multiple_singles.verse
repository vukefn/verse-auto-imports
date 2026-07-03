# Playbook T1: several single-suggestion diagnostics arriving in the same
# debounce window must each produce exactly one import, applied together.

t1_gadget := class:
    var MaybeButton:?button_device = false
    GetImage():texture = DefaultTexture
    Register(Who:agent):void = {}
