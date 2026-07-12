import { ImportFormatter } from "../ImportFormatter";

describe("ImportFormatter.sortImportsByRank", () => {
    let formatter: ImportFormatter;

    beforeEach(() => {
        formatter = new ImportFormatter();
    });

    it("orders absolute paths before bare identifiers before dotted references", () => {
        expect(formatter.sortImportsByRank(["Economy.Shop", "/Verse.org/Simulation", "Features"])).toEqual(["/Verse.org/Simulation", "Features", "Economy.Shop"]);
    });

    it("keeps bare identifiers in their original input order", () => {
        expect(formatter.sortImportsByRank(["Zeta", "Economy.Shop", "Alpha"])).toEqual(["Zeta", "Alpha", "Economy.Shop"]);
    });

    it("alphabetizes absolute paths among themselves", () => {
        expect(formatter.sortImportsByRank(["/Verse.org/Simulation", "/Fortnite.com/Devices"])).toEqual(["/Fortnite.com/Devices", "/Verse.org/Simulation"]);
    });

    it("alphabetizes dotted references among themselves", () => {
        expect(formatter.sortImportsByRank(["Systems.Economy", "Features.Economy"])).toEqual(["Features.Economy", "Systems.Economy"]);
    });
});

describe("ImportFormatter.groupAndFormatImports", () => {
    let formatter: ImportFormatter;

    beforeEach(() => {
        formatter = new ImportFormatter();
    });

    it("digestFirst with sorting: local group orders the bare import before the dotted import that depends on it", () => {
        const result = formatter.groupAndFormatImports(["/Verse.org/Simulation", "Economy.Shop", "Features"], false, true, "digestFirst");
        expect(result).toEqual(["using { /Verse.org/Simulation }", "", "using { Features }", "using { Economy.Shop }"]);
    });

    it("grouping none with sorting: absolute paths first (alpha), then bare (input order), then dotted (alpha)", () => {
        const result = formatter.groupAndFormatImports(["Systems.Economy", "/Verse.org/Simulation", "Zeta", "/Fortnite.com/Devices", "Alpha", "Features.Economy"], false, true, "none");
        expect(result).toEqual(["using { /Fortnite.com/Devices }", "using { /Verse.org/Simulation }", "using { Zeta }", "using { Alpha }", "using { Features.Economy }", "using { Systems.Economy }"]);
    });

    it("grouping none without sorting: leaves the original order untouched", () => {
        const result = formatter.groupAndFormatImports(["Zeta", "Economy.Shop", "/Verse.org/Simulation"], false, false, "none");
        expect(result).toEqual(["using { Zeta }", "using { Economy.Shop }", "using { /Verse.org/Simulation }"]);
    });

    it("digestFirst without sorting: leaves the original order untouched within each group", () => {
        const result = formatter.groupAndFormatImports(["Zeta", "/Verse.org/Simulation", "Economy.Shop"], false, false, "digestFirst");
        expect(result).toEqual(["using { /Verse.org/Simulation }", "", "using { Zeta }", "using { Economy.Shop }"]);
    });
});
