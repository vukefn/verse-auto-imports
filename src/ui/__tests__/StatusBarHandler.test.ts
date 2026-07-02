import { StatusBarHandler } from "../StatusBarHandler";
import * as vscode from "vscode";

describe("StatusBarHandler snooze timer lifecycle", () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.clearAllTimers();
        jest.useRealTimers();
        jest.clearAllMocks();
    });

    function makeHandler(): StatusBarHandler {
        const outputChannel = vscode.window.createOutputChannel("test");
        return new StatusBarHandler(outputChannel);
    }

    it("runs exactly one interval while snoozed", () => {
        const handler = makeHandler();
        expect(jest.getTimerCount()).toBe(0);

        handler.startSnooze(5);
        expect(jest.getTimerCount()).toBe(1);
    });

    it("does not leak an interval when snooze is started again while active", () => {
        const clearSpy = jest.spyOn(global, "clearInterval");
        const handler = makeHandler();

        handler.startSnooze(5);
        clearSpy.mockClear();

        // Re-invoke while already snoozed (reachable via the command palette).
        handler.startSnooze(5);

        // The prior interval must have been cleared, leaving exactly one.
        expect(clearSpy).toHaveBeenCalledTimes(1);
        expect(jest.getTimerCount()).toBe(1);
    });

    it("clears the interval on cancel", () => {
        const handler = makeHandler();
        handler.startSnooze(5);
        expect(jest.getTimerCount()).toBe(1);

        handler.cancelSnooze();
        expect(jest.getTimerCount()).toBe(0);
    });

    it("clears the interval on dispose", () => {
        const handler = makeHandler();
        handler.startSnooze(5);
        expect(jest.getTimerCount()).toBe(1);

        handler.dispose();
        expect(jest.getTimerCount()).toBe(0);
    });
});
