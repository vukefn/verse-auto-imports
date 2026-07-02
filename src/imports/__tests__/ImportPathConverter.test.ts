import { ImportPathConverter } from "../ImportPathConverter";

describe("ImportPathConverter.buildFullVersePath", () => {
  const projectVersePath = "/mygame@fortnite.com/mygame";

  it("places a Content-root module directly under the project verse path", () => {
    expect(
      ImportPathConverter.buildFullVersePath(projectVersePath, "", "Inventory"),
    ).toBe("/mygame@fortnite.com/mygame/Inventory");
  });

  it('treats a bare "/" location the same as the Content root', () => {
    expect(
      ImportPathConverter.buildFullVersePath(
        projectVersePath,
        "/",
        "Inventory",
      ),
    ).toBe("/mygame@fortnite.com/mygame/Inventory");
  });

  it("inserts a subdirectory location between project path and module", () => {
    expect(
      ImportPathConverter.buildFullVersePath(
        projectVersePath,
        "/Systems",
        "Inventory",
      ),
    ).toBe("/mygame@fortnite.com/mygame/Systems/Inventory");
  });

  it("supports nested locations and multi-segment module paths", () => {
    expect(
      ImportPathConverter.buildFullVersePath(
        projectVersePath,
        "/UI/Shared",
        "HUD/Textures",
      ),
    ).toBe("/mygame@fortnite.com/mygame/UI/Shared/HUD/Textures");
  });
});
