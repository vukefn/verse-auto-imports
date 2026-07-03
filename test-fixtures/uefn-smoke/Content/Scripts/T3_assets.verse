# T3: asset reference handling against the live 41.10 Assets.digest.verse.
# Requires PLAYBOOK Phase A (assets created in UEFN) to be complete.
#
# Expected for each unqualified asset reference below: the compiler reports an
# unknown identifier and suggests the qualified name (e.g. Folder1.image2).
# The extension must NEVER produce an import that includes the asset name
# itself (e.g. "using { Folder1.image2 }" is wrong; "using { Folder1 }" is
# acceptable). Record the exact error text and what the extension did.
#
# Confirmed on live 41.10 (see the generated Assets.digest.verse): instances
# are "name<scoped {...}>:texture = external {}" and class-generating assets
# (materials, mesh components, VFX components) use "<scoped {...}>" visibility,
# so AssetsDigestParser parses 0 names. The leaf-stripping below still works
# because the extractor strips the suggestion segment matching the unknown
# identifier - it does not need the digest for this error shape.

t3_probe := class:
    # texture instance one folder deep (Folder1/image2)
    GetImage():texture = image2

    # texture instance two folders deep (Folder1/InnerFolder/image3)
    GetInnerImage():texture = image3

# Materials are the only asset type generating a CLASS whose fields matter.
# Live 41.10 digest name is the asset's own name (TestMaterial - no _material
# suffix, contrary to the Epic doc example). Expected: compiler suggests
# Materials.TestMaterial; extension imports using { Materials }, never
# using { Materials.TestMaterial }.
t3_material_probe := class:
    var MaybeMaterial:?TestMaterial = false
