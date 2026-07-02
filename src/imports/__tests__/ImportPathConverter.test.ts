import { ImportPathConverter } from "../ImportPathConverter";

describe("ImportPathConverter.buildFullVersePath", () => {
    const projectVersePath = "/mygame@fortnite.com/mygame";

    it("places a Content-root module directly under the project verse path", () => {
        expect(ImportPathConverter.buildFullVersePath(projectVersePath, "", "Inventory")).toBe("/mygame@fortnite.com/mygame/Inventory");
    });

    it('treats a bare "/" location the same as the Content root', () => {
        expect(ImportPathConverter.buildFullVersePath(projectVersePath, "/", "Inventory")).toBe("/mygame@fortnite.com/mygame/Inventory");
    });

    it("inserts a subdirectory location between project path and module", () => {
        expect(ImportPathConverter.buildFullVersePath(projectVersePath, "/Systems", "Inventory")).toBe("/mygame@fortnite.com/mygame/Systems/Inventory");
    });

    it("supports nested locations and multi-segment module paths", () => {
        expect(ImportPathConverter.buildFullVersePath(projectVersePath, "/UI/Shared", "HUD/Textures")).toBe("/mygame@fortnite.com/mygame/UI/Shared/HUD/Textures");
    });
});

describe("ImportPathConverter.buildModuleDefinitionRegex", () => {
    it("matches a module declaration with and without a visibility specifier", () => {
        const re = ImportPathConverter.buildModuleDefinitionRegex("Inventory");
        expect(re.test("Inventory := module:")).toBe(true);
        expect(re.test("Inventory<public> := module:")).toBe(true);
        expect(re.test("Inventory := module>")).toBe(true);
    });

    it("does not match a different module or a non-module declaration", () => {
        const re = ImportPathConverter.buildModuleDefinitionRegex("Inventory");
        expect(re.test("MyInventory := module:")).toBe(false);
        expect(re.test("Inventory := class:")).toBe(false);
        expect(re.test("InventoryItem := module:")).toBe(false);
    });

    it("is not global, so repeated .test() calls are order-independent", () => {
        // A global regex would retain lastIndex between calls and could skip a
        // match in a later string depending on where the previous match ended.
        const re = ImportPathConverter.buildModuleDefinitionRegex("Foo");
        expect(re.flags).not.toContain("g");

        const withLateMatch = "some preamble text here\n\n\nFoo := module:";
        const withEarlyMatch = "Foo := module:";

        // Call against a string whose match is far into the text, then against a
        // string whose match is at the very start. Both must return true.
        expect(re.test(withLateMatch)).toBe(true);
        expect(re.test(withEarlyMatch)).toBe(true);
        expect(re.test(withLateMatch)).toBe(true);
    });

    it("escapes regex metacharacters in the module name", () => {
        const re = ImportPathConverter.buildModuleDefinitionRegex("a.b");
        expect(re.test("a.b := module:")).toBe(true);
        expect(re.test("axb := module:")).toBe(false);
    });
});
