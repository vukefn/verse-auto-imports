# T3: asset reference handling against the live 41.10 Assets.digest.verse.
# Requires PLAYBOOK Phase A (assets created in UEFN) to be complete.
#
# Expected for each unqualified asset reference below: the compiler reports an
# unknown identifier and suggests the qualified name (e.g. Folder1.image2).
# The extension must NEVER produce an import that includes the asset name
# itself (e.g. "using { Folder1.image2 }" is wrong; "using { Folder1 }" is
# acceptable). Record the exact error text and what the extension did.
#
# Known risk being validated: AssetsDigestParser only recognizes
# "Name<public|internal|private> := class/struct" but 41.10 emits
# "name<scoped {Project}>:texture = external {}" for instances and
# "Name<scoped {Project}> := class<final><public>(material)" for materials.

t3_probe := class:
    # texture instance one folder deep (Folder1/image2)
    GetImage():texture = image2

    # texture instance two folders deep (Folder1/InnerFolder/image3)
    GetInnerImage():texture = image3

# Uncomment after Phase A adds Materials/TestMaterial in UEFN. Materials are
# the only asset type that generates a CLASS in the digest, which is the exact
# code path the 0.6.2 asset-class fix targets.
# t3_material_probe := class:
#     GetMaterial():TestMaterial_material = TestMaterial_material{}
