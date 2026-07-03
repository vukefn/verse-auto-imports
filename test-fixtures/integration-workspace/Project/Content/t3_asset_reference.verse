# Playbook T3 (extractor half): a "Did you mean Folder1.image2" asset
# suggestion must import the containing folder, never the asset itself.

t3_probe := class:
    GetImage():texture = image2
