import { buildProjectIndexes, resolveModuleLocations } from "../moduleLocationLookup";
import { ProjectPathNode } from "../../types";

function moduleNode(name: string, fullPath: string, sourceFile: string): ProjectPathNode {
    return { name, fullPath, type: "module", isPublic: true, sourceFile };
}

function classNode(name: string, fullPath: string, sourceFile: string): ProjectPathNode {
    return { name, fullPath, type: "class", isPublic: true, sourceFile };
}

function resolve(modulePath: string, nodes: ProjectPathNode[], workspaceIsContent = false) {
    const { moduleNameIndex } = buildProjectIndexes(nodes);
    return resolveModuleLocations(modulePath, moduleNameIndex, {
        workspaceIsContent,
    });
}

describe("buildProjectIndexes", () => {
    it("indexes identifiers case-insensitively but module names exactly", () => {
        const nodes = [moduleNode("Inventory", "Inventory", "Content/File.verse"), classNode("Widget", "Widget", "Content/File.verse")];

        const indexes = buildProjectIndexes(nodes);

        expect(indexes.identifierIndex.get("inventory")).toHaveLength(1);
        expect(indexes.identifierIndex.get("widget")).toHaveLength(1);
        expect(indexes.moduleNameIndex.get("Inventory")).toHaveLength(1);
        expect(indexes.moduleNameIndex.get("inventory")).toBeUndefined();
    });

    it("only includes module declarations in the module name index", () => {
        const nodes = [classNode("Inventory", "Systems.Inventory", "Content/File.verse"), moduleNode("Systems", "Systems", "Content/File.verse")];

        const indexes = buildProjectIndexes(nodes);

        expect(indexes.moduleNameIndex.has("Inventory")).toBe(false);
        expect(indexes.moduleNameIndex.has("Systems")).toBe(true);
    });

    it("groups nodes by source file", () => {
        const nodes = [moduleNode("A", "A", "Content/One.verse"), moduleNode("B", "B", "Content/One.verse"), moduleNode("C", "C", "Content/Two.verse")];

        const indexes = buildProjectIndexes(nodes);

        expect(indexes.fileIndex.get("Content/One.verse")).toHaveLength(2);
        expect(indexes.fileIndex.get("Content/Two.verse")).toHaveLength(1);
    });
});

describe("resolveModuleLocations", () => {
    it("resolves a top-level module declared in a file at the Content root", () => {
        const nodes = [moduleNode("Inventory", "Inventory", "Content/Main.verse")];

        expect(resolve("Inventory", nodes)).toEqual([{ location: "", sourceFile: "Content/Main.verse" }]);
    });

    it("resolves a module declared in a subdirectory to that directory prefix", () => {
        const nodes = [moduleNode("Inventory", "Inventory", "Content/Systems/Main.verse")];

        expect(resolve("Inventory", nodes)).toEqual([{ location: "/Systems", sourceFile: "Content/Systems/Main.verse" }]);
    });

    it("does not match by name suffix (Utils must not match MyUtils)", () => {
        const nodes = [moduleNode("MyUtils", "MyUtils", "Content/Main.verse")];

        expect(resolve("Utils", nodes)).toEqual([]);
    });

    it("matches names case-sensitively", () => {
        const nodes = [moduleNode("Utils", "Utils", "Content/Main.verse")];

        expect(resolve("utils", nodes)).toEqual([]);
    });

    it("never returns non-module declarations", () => {
        const nodes = [classNode("Inventory", "Inventory", "Content/Main.verse"), classNode("Inventory", "Systems.Inventory", "Content/Other.verse")];

        expect(resolve("Inventory", nodes)).toEqual([]);
    });

    it("does not match a nested module by its bare name", () => {
        // Importing a nested module requires the full chain in Verse.
        const nodes = [moduleNode("Inventory", "Systems.Inventory", "Content/Main.verse")];

        expect(resolve("Inventory", nodes)).toEqual([]);
    });

    it("resolves a module nested inside another module in the same file", () => {
        // HUD := module: containing Textures := module:, in Content/Foo/UI.verse
        const nodes = [moduleNode("HUD", "HUD", "Content/Foo/UI.verse"), moduleNode("Textures", "HUD.Textures", "Content/Foo/UI.verse")];

        expect(resolve("HUD/Textures", nodes)).toEqual([{ location: "/Foo", sourceFile: "Content/Foo/UI.verse" }]);
    });

    it("resolves remaining segments against the file's directory tail (implicit folder modules)", () => {
        // Textures := module: at top level of a file inside Content/HUD/
        const nodes = [moduleNode("Textures", "Textures", "Content/HUD/Textures.verse")];

        expect(resolve("HUD/Textures", nodes)).toEqual([{ location: "", sourceFile: "Content/HUD/Textures.verse" }]);
    });

    it("rejects candidates whose directory does not match the remaining segments", () => {
        const nodes = [moduleNode("Textures", "Textures", "Content/Other/Textures.verse")];

        expect(resolve("HUD/Textures", nodes)).toEqual([]);
    });

    it("normalizes a leading slash on the requested path", () => {
        const nodes = [moduleNode("Inventory", "Inventory", "Content/Main.verse")];

        expect(resolve("/Inventory", nodes)).toEqual([{ location: "", sourceFile: "Content/Main.verse" }]);
    });

    it("excludes files outside the Content folder", () => {
        const nodes = [moduleNode("Inventory", "Inventory", "Docs/Main.verse")];

        expect(resolve("Inventory", nodes)).toEqual([]);
    });

    it("treats source paths as Content-relative when the workspace is the Content folder", () => {
        const nodes = [moduleNode("Inventory", "Inventory", "Systems/Main.verse")];

        expect(resolve("Inventory", nodes, true)).toEqual([{ location: "/Systems", sourceFile: "Systems/Main.verse" }]);
        expect(resolve("Inventory", nodes, false)).toEqual([]);
    });

    it("resolves files directly at the workspace root when the workspace is Content", () => {
        const nodes = [moduleNode("Inventory", "Inventory", "Main.verse")];

        expect(resolve("Inventory", nodes, true)).toEqual([{ location: "", sourceFile: "Main.verse" }]);
    });

    it("deduplicates candidates that resolve to the same location", () => {
        const nodes = [
            moduleNode("Inventory", "Inventory", "Content/One.verse"),
            moduleNode("Inventory", "Inventory", "Content/Two.verse"),
            moduleNode("Inventory", "Inventory", "Content/Sub/Three.verse"),
        ];

        expect(resolve("Inventory", nodes)).toEqual([
            { location: "", sourceFile: "Content/One.verse" },
            { location: "/Sub", sourceFile: "Content/Sub/Three.verse" },
        ]);
    });

    it("returns nothing for an empty request", () => {
        const nodes = [moduleNode("Inventory", "Inventory", "Content/Main.verse")];

        expect(resolve("", nodes)).toEqual([]);
        expect(resolve("/", nodes)).toEqual([]);
    });

    it("produces identical results after a JSON serialization round-trip", () => {
        const nodes = [
            moduleNode("HUD", "HUD", "Content/Foo/UI.verse"),
            moduleNode("Textures", "HUD.Textures", "Content/Foo/UI.verse"),
            moduleNode("Inventory", "Inventory", "Content/Systems/Main.verse"),
            classNode("Widget", "HUD.Widget", "Content/Foo/UI.verse"),
        ];

        const roundTripped: ProjectPathNode[] = JSON.parse(JSON.stringify(nodes));

        for (const request of ["HUD/Textures", "Inventory", "Widget"]) {
            expect(resolve(request, roundTripped)).toEqual(resolve(request, nodes));
        }
    });
});
