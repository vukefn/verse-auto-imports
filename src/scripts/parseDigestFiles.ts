#!/usr/bin/env node
/**
 * Build-time script to parse .verse digest files into JSON.
 * This pre-compiles the digest files so they can be loaded quickly at runtime
 * without parsing the raw .verse files each time.
 *
 * Run with: npx ts-node src/scripts/parseDigestFiles.ts
 * Or via npm: npm run parse-digest
 */

import * as fs from "fs";
import * as path from "path";

// Types matching DigestParser
interface DigestEntry {
    identifier: string;
    modulePath: string;
    type: "class" | "function" | "variable" | "module" | "unknown";
    description?: string;
    isPublic: boolean;
}

interface PrecompiledDigest {
    version: string;
    generatedAt: string;
    sourceFile: string;
    sourceBuild: string;
    entries: Record<string, DigestEntry>;
    moduleIndex: Record<string, string[]>;
}

const DIGEST_FILES = ["Fortnite.digest.verse", "UnrealEngine.digest.verse", "Verse.digest.verse"];

const VERSION = "1.0.0";

/**
 * Extract the build reference from the digest file content.
 * Looks for patterns like: ++Fortnite+Release-37.20-CL-45679054
 */
function extractBuildReference(content: string): string {
    const buildMatch = content.match(/\+\+Fortnite\+Release-[\d.]+-CL-\d+/);
    return buildMatch ? buildMatch[0] : "unknown";
}

/**
 * Parse a single digest file and return structured data.
 * Logic extracted from DigestParser.parseDigestFile()
 */
function parseDigestFile(filePath: string): PrecompiledDigest {
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split("\n");
    const fileName = path.basename(filePath);

    const entries: Record<string, DigestEntry> = {};
    const moduleIndex: Record<string, string[]> = {};

    let currentModulePath = "";
    const moduleStack: string[] = [];

    // Helper to add entry
    const addEntry = (identifier: string, modulePath: string, type: DigestEntry["type"], isPublic: boolean) => {
        if (!isPublic || entries[identifier]) {
            return; // Skip non-public or duplicates
        }

        entries[identifier] = {
            identifier,
            modulePath,
            type,
            isPublic,
        };

        // Update module index
        if (!moduleIndex[modulePath]) {
            moduleIndex[modulePath] = [];
        }
        moduleIndex[modulePath].push(identifier);
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        // Skip empty lines
        if (line === "") {
            continue;
        }

        // Check for module import path comments
        if (line.startsWith("#")) {
            const modulePathMatch = line.match(/# Module import path: (.+)/);
            if (modulePathMatch) {
                currentModulePath = modulePathMatch[1];
            }
            continue;
        }

        // Skip using statements
        if (line.startsWith("using {")) {
            continue;
        }

        // Parse module declarations
        const moduleMatch = line.match(/^(\w+)<public>\s*:=\s*module:/);
        if (moduleMatch) {
            const moduleName = moduleMatch[1];
            if (currentModulePath) {
                moduleStack.push(currentModulePath);
            } else {
                moduleStack.push(`/${moduleName}`);
            }
            addEntry(moduleName, moduleStack[moduleStack.length - 1], "module", true);
            continue;
        }

        // Parse class declarations
        const classMatch = line.match(/^(\w+)<public>\s*:=\s*class/);
        if (classMatch) {
            const className = classMatch[1];
            const modulePath = moduleStack.length > 0 ? moduleStack[moduleStack.length - 1] : currentModulePath;
            addEntry(className, modulePath, "class", true);
            continue;
        }

        // Parse struct declarations
        const structMatch = line.match(/^(\w+)<public>\s*:=\s*struct/);
        if (structMatch) {
            const structName = structMatch[1];
            const modulePath = moduleStack.length > 0 ? moduleStack[moduleStack.length - 1] : currentModulePath;
            addEntry(structName, modulePath, "class", true); // Treat structs as classes
            continue;
        }

        // Parse function/variable declarations
        const identifierMatch = line.match(/^(\w+)<public>\s*[:=]/);
        if (identifierMatch) {
            const identifier = identifierMatch[1];
            const modulePath = moduleStack.length > 0 ? moduleStack[moduleStack.length - 1] : currentModulePath;

            // Determine type based on line content
            let type: "function" | "variable" = "variable";
            if (line.includes("(") && line.includes(")")) {
                type = "function";
            }

            addEntry(identifier, modulePath, type, true);
            continue;
        }

        // Handle nested structures with native/public visibility
        if (line && !line.includes("<public>") && !line.includes(":=")) {
            const nestedMatch = line.match(/^(\w+)<(?:native\s*)?<public>/);
            if (nestedMatch) {
                const identifier = nestedMatch[1];
                const modulePath = moduleStack.length > 0 ? moduleStack[moduleStack.length - 1] : currentModulePath;

                let type: "function" | "variable" = "variable";
                if (line.includes("(") && line.includes(")")) {
                    type = "function";
                }

                addEntry(identifier, modulePath, type, true);
            }
        }
    }

    return {
        version: VERSION,
        generatedAt: new Date().toISOString(),
        sourceFile: fileName,
        sourceBuild: extractBuildReference(content),
        entries,
        moduleIndex,
    };
}

/**
 * Main function to parse all digest files
 */
function main() {
    const scriptDir = __dirname;
    const srcDir = path.resolve(scriptDir, "..");
    const utilsDir = path.join(srcDir, "utils");
    const dataDir = path.join(srcDir, "data");

    console.log("Parsing Verse digest files...");
    console.log(`  Source: ${utilsDir}`);
    console.log(`  Output: ${dataDir}`);
    console.log("");

    // Ensure data directory exists
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
        console.log(`Created directory: ${dataDir}`);
    }

    let totalEntries = 0;

    for (const digestFile of DIGEST_FILES) {
        const inputPath = path.join(utilsDir, digestFile);

        if (!fs.existsSync(inputPath)) {
            console.warn(`  Warning: ${digestFile} not found, skipping`);
            continue;
        }

        console.log(`  Parsing ${digestFile}...`);

        const digest = parseDigestFile(inputPath);
        const entryCount = Object.keys(digest.entries).length;
        const moduleCount = Object.keys(digest.moduleIndex).length;
        totalEntries += entryCount;

        const outputFile = digestFile.replace(".verse", ".json");
        const outputPath = path.join(dataDir, outputFile);

        fs.writeFileSync(outputPath, JSON.stringify(digest, null, 2));

        console.log(`    -> ${outputFile}`);
        console.log(`       ${entryCount} entries, ${moduleCount} modules`);
        console.log(`       Build: ${digest.sourceBuild}`);
    }

    console.log("");
    console.log(`Done! Total: ${totalEntries} entries parsed`);
}

main();
