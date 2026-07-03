import { DiagnosticsHandler } from "../DiagnosticsHandler";

describe("DiagnosticsHandler.shouldProcessUri", () => {
    const fileUri = (fsPath: string) => ({ scheme: "file", fsPath });

    it("accepts a regular .verse file", () => {
        expect(DiagnosticsHandler.shouldProcessUri(fileUri("C:\\Project\\Content\\Scripts\\device.verse"))).toBe(true);
        expect(DiagnosticsHandler.shouldProcessUri(fileUri("/home/user/Content/device.verse"))).toBe(true);
    });

    it("rejects VS Code internal document schemes", () => {
        // Replace-preview buffers appear in diagnostics events while an edit
        // preview is in flight; opening them throws.
        expect(DiagnosticsHandler.shouldProcessUri({ scheme: "private", fsPath: "/replacePreview" })).toBe(false);
        expect(DiagnosticsHandler.shouldProcessUri({ scheme: "git", fsPath: "/repo/file.verse" })).toBe(false);
        expect(DiagnosticsHandler.shouldProcessUri({ scheme: "output", fsPath: "extension-output" })).toBe(false);
        expect(DiagnosticsHandler.shouldProcessUri({ scheme: "untitled", fsPath: "Untitled-1" })).toBe(false);
    });

    it("rejects Epic's generated digest files", () => {
        // Digest files carry permanent LSP errors in a UEFN workspace and are
        // read-only reference material; the extension must never process them.
        expect(DiagnosticsHandler.shouldProcessUri(fileUri("C:\\VerseProject\\Fortnite\\Fortnite.digest.verse"))).toBe(false);
        expect(DiagnosticsHandler.shouldProcessUri(fileUri("C:\\VerseProject\\P-Assets\\Assets.digest.verse"))).toBe(false);
    });

    it("rejects non-verse files", () => {
        expect(DiagnosticsHandler.shouldProcessUri(fileUri("C:\\Project\\Content\\readme.md"))).toBe(false);
        expect(DiagnosticsHandler.shouldProcessUri(fileUri("C:\\Project\\project.uefnproject"))).toBe(false);
    });

    it("is case-insensitive about the extension", () => {
        expect(DiagnosticsHandler.shouldProcessUri(fileUri("C:\\Project\\Device.VERSE"))).toBe(true);
        expect(DiagnosticsHandler.shouldProcessUri(fileUri("C:\\Project\\Assets.DIGEST.verse"))).toBe(false);
    });
});
