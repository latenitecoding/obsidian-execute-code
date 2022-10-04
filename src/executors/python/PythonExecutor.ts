import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import ExecuteCodePlugin from "src/main";
import { Outputter } from "src/Outputter";
import { ExecutorSettings } from "src/Settings";
import AsyncExecutor from "../AsyncExecutor";
import wrapPython from "./wrapPython";

export default class PythonExecutor extends AsyncExecutor {

    process: ChildProcessWithoutNullStreams
    
    printFunctionName: string;
    localsDictionaryName: string;
    globalsDictionaryName: string;

    constructor(settings: ExecutorSettings, file: string) {
        super(file, "python");

        const args = settings.pythonArgs ? settings.pythonArgs.split(" ") : [];

        args.unshift("-i");

        this.process = spawn(settings.pythonPath, args);
        
        //this.process.stdout.on("data", (x) => console.log(x.toString()))
        //this.process.stderr.on("data", (x) => console.log(x.toString()))
        
        this.printFunctionName = `__print_${Math.random().toString().substring(2)}_${Date.now()}`;
        this.localsDictionaryName = `__locals_${Math.random().toString().substring(2)}_${Date.now()}`;
        this.globalsDictionaryName = `__locals_${Math.random().toString().substring(2)}_${Date.now()}`;

        //send a newline so that the intro message won't be buffered
        this.dismissIntroMessage();
    }
    
    /**
     * Close the runtime.
     * @returns A promise that resolves once the runtime is fully closed
     */
    stop(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.process.kill();
            this.process.on("close", () => {
                resolve();
            });
            this.emit("close");
        });
    }

    /**
     * Swallows and does not output the "Welcome to Python v..." message that shows at startup.
     * Also sets the printFunctionName up correctly.
     */
    async dismissIntroMessage() {
        this.addJobToQueue((resolve, reject) => {
            this.process.stdin.write(
`from __future__ import print_function
import sys
${this.printFunctionName} = print

${this.localsDictionaryName} = {}
${this.globalsDictionaryName} = {**globals()}
`.replace(/\r\n/g, "\n"));

            this.process.stderr.once("data", (data) => {
                resolve();
            });
        });
    }

    /**
     * Run some Python code
     * @param code code to run
     * @param outputter outputter to use
     * @param cmd Not used
     * @param cmdArgs Not used
     * @param ext Not used
     * @returns A promise that resolves once the code is done running
     */
    async run(code: string, outputter: Outputter, cmd: string, cmdArgs: string, ext: string) {
        return this.addJobToQueue((resolve, reject) => {
            const finishSigil = `SIGIL_BLOCK_DONE${Math.random()}_${Date.now()}_${code.length}`;
            
            const wrappedCode = wrapPython(code, 
                this.globalsDictionaryName,
                this.localsDictionaryName,
                this.printFunctionName,
                finishSigil
            );
            
            console.log(wrappedCode);
            
            //import print from builtins to circumnavigate the case where the user redefines print
            this.process.stdin.write(wrappedCode);
            
            outputter.clear();
            
            outputter.on("data", (data: string) => {
                this.process.stdin.write(data);
            });

            let writeToStdout = (data: any) => {
                let str = data.toString();
                
                if (str.endsWith(finishSigil)) {
                    str = str.substring(0, str.length - finishSigil.length);
                    console.log(str);
                    
                    this.process.stdout.removeListener("data", writeToStdout)
                    this.process.stderr.removeListener("data", writeToStderr);
                    outputter.write(str);
                    
                    resolve();
                } else {
                    outputter.write(str);
                }
            };

            let writeToStderr = (data: any) => {
                const removedPrompts = data.toString().replace(/(^((\.\.\.|>>>) )+)|(((\.\.\.|>>>) )+$)/g, "")

                outputter.writeErr(removedPrompts);
            }

            this.process.stdout.on("data", writeToStdout);
            this.process.stderr.on("data", writeToStderr);
        });
    }

}