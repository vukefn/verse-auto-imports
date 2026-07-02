import { ImportDocumentEditor } from "../ImportDocumentEditor";
import { ImportFormatter } from "../ImportFormatter";
import * as vscode from "vscode";

describe("ImportDocumentEditor.buildOrganizedContent", () => {
  let editor: ImportDocumentEditor;

  const curlyNoSort = {
    preferDotSyntax: false,
    sortAlphabetically: false,
    importGrouping: "none",
  };
  const curlySorted = { ...curlyNoSort, sortAlphabetically: true };

  beforeEach(() => {
    const outputChannel = vscode.window.createOutputChannel("test");
    editor = new ImportDocumentEditor(outputChannel, new ImportFormatter());
  });

  it("returns null when there are no imports and nothing to add", () => {
    expect(
      editor.buildOrganizedContent("foo := 1\nbar := 2", [], curlyNoSort),
    ).toBeNull();
  });

  it("consolidates existing imports at the top with one blank line before code", () => {
    const input = "using { /A }\nusing { /B }\ncode()";
    expect(editor.buildOrganizedContent(input, [], curlyNoSort)).toBe(
      "using { /A }\nusing { /B }\n\ncode()",
    );
  });

  it("deduplicates repeated imports", () => {
    const input = "using { /A }\nusing { /A }\ncode()";
    expect(editor.buildOrganizedContent(input, [], curlyNoSort)).toBe(
      "using { /A }\n\ncode()",
    );
  });

  it("sorts alphabetically when enabled", () => {
    const input = "using { /Zebra }\nusing { /Apple }\ncode()";
    expect(editor.buildOrganizedContent(input, [], curlySorted)).toBe(
      "using { /Apple }\nusing { /Zebra }\n\ncode()",
    );
  });

  it("preserves original order when sorting is disabled", () => {
    const input = "using { /Zebra }\nusing { /Apple }\ncode()";
    expect(editor.buildOrganizedContent(input, [], curlyNoSort)).toBe(
      "using { /Zebra }\nusing { /Apple }\n\ncode()",
    );
  });

  it("writes the preferred dot syntax", () => {
    const input = "using { /A }\ncode()";
    expect(
      editor.buildOrganizedContent(input, [], {
        ...curlyNoSort,
        preferDotSyntax: true,
      }),
    ).toBe("using. /A\n\ncode()");
  });

  it("normalizes the indented using: pair into a single-line import", () => {
    const input = "using:\n    /A\ncode()";
    expect(editor.buildOrganizedContent(input, [], curlyNoSort)).toBe(
      "using { /A }\n\ncode()",
    );
  });

  it("hoists an import scattered below code up into the block", () => {
    const input = "code_before()\nusing { /A }\ncode_after()";
    expect(editor.buildOrganizedContent(input, [], curlyNoSort)).toBe(
      "using { /A }\n\ncode_before()\ncode_after()",
    );
  });

  it("merges additional paths with existing imports, deduped and sorted", () => {
    const input = "using { /Existing }\ncode()";
    expect(
      editor.buildOrganizedContent(input, ["/Added", "/Existing"], curlySorted),
    ).toBe("using { /Added }\nusing { /Existing }\n\ncode()");
  });

  it("adds imports to a document that had none", () => {
    expect(editor.buildOrganizedContent("code()", ["/New"], curlyNoSort)).toBe(
      "using { /New }\n\ncode()",
    );
  });

  it("leaves local-scope using statements in the body", () => {
    const input = "using { /A }\nusing { LocalVar }\ncode()";
    expect(editor.buildOrganizedContent(input, [], curlyNoSort)).toBe(
      "using { /A }\n\nusing { LocalVar }\ncode()",
    );
  });

  it("collapses extra blank lines left by removed top imports", () => {
    const input = "using { /A }\n\n\ncode()";
    expect(editor.buildOrganizedContent(input, [], curlyNoSort)).toBe(
      "using { /A }\n\ncode()",
    );
  });

  it("returns only the import block when the file is nothing but imports", () => {
    const input = "using { /B }\nusing { /A }";
    expect(editor.buildOrganizedContent(input, [], curlySorted)).toBe(
      "using { /A }\nusing { /B }\n",
    );
  });

  it("ignores blank additional paths", () => {
    const input = "using { /A }\ncode()";
    expect(editor.buildOrganizedContent(input, ["", "   "], curlyNoSort)).toBe(
      "using { /A }\n\ncode()",
    );
  });
});
