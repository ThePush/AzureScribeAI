"use strict";

import * as vscode from "vscode";
import {
    OpenAIClient,
    AzureKeyCredential,
    ChatRequestMessage,
} from "@azure/openai";

let openai: OpenAIClient | undefined = undefined;
let commentId = 1;

class NoteComment implements vscode.Comment {
    id: number;
    label: string | undefined;
    savedBody: string | vscode.MarkdownString; // for the Cancel button
    constructor(
        public body: string | vscode.MarkdownString,
        public mode: vscode.CommentMode,
        public author: vscode.CommentAuthorInformation,
        public parent?: vscode.CommentThread,
        public contextValue?: string
    ) {
        this.id = ++commentId;
        this.savedBody = this.body;
    }
}

function getApiKey(): string | undefined {
    return vscode.workspace.getConfiguration("azurescribeai").get("ApiKey") as
        | string
        | undefined;
}

function getEndpoint(): string | undefined {
    return vscode.workspace
        .getConfiguration("azurescribeai")
        .get("endpoint") as string | undefined;
}

function getDeploymentId(): string | undefined {
    return vscode.workspace
        .getConfiguration("azurescribeai")
        .get("deploymentName") as string | undefined;
}

/**
 * Shows an input box for getting API key using window.showInputBox().
 * Updates the User Settings API Key with the newly inputted API Key.
 */
export async function showInputBoxForApiKey() {
    const result = await vscode.window.showInputBox({
        ignoreFocusOut: true,
        placeHolder: "Your Azure OpenAI API Key",
        title: "Azure OpenAI API Key",
        prompt: "Please enter your Azure OpenAI API key.",
    });
    vscode.window.showInformationMessage(`Got API key: ${result}`);
    // Write to user settings
    await vscode.workspace
        .getConfiguration("azurescribeai")
        .update("ApiKey", result, true);
    // Write to workspace settings
    //await vscode.workspace.getConfiguration('azurescribeai').update('ApiKey', result, false);
    return result;
}

async function showInputBoxForEndpoint() {
    const endpoint = await vscode.window.showInputBox({
        ignoreFocusOut: true,
        placeHolder: "Enter your Azure OpenAI endpoint",
        title: "Azure OpenAI Endpoint",
        prompt: "Please enter your Azure OpenAI endpoint.",
    });
    vscode.window.showInformationMessage(`Got endpoint: ${endpoint}`);
    await vscode.workspace
        .getConfiguration("azurescribeai")
        .update("endpoint", endpoint, true);
    return endpoint;
}

async function showInputBoxForDeploymentId() {
    const deploymentId = await vscode.window.showInputBox({
        ignoreFocusOut: true,
        placeHolder: "Enter your Azure OpenAI Deployment name",
        title: "Azure OpenAI Deployment name",
        prompt: "Please enter your Azure OpenAI Deployment name.",
    });
    vscode.window.showInformationMessage(
        `Got deployment name: ${deploymentId}`
    );
    await vscode.workspace
        .getConfiguration("azurescribeai")
        .update("deploymentName", deploymentId, true);
    return deploymentId;
}

async function createAzureOpenAIClient() {
    if (getApiKey() === undefined || getApiKey() === "") {
        await showInputBoxForApiKey();
    }
    if (getEndpoint() === undefined || getEndpoint() === "") {
        await showInputBoxForEndpoint();
    }
    if (getDeploymentId() === undefined || getDeploymentId() === "") {
        await showInputBoxForDeploymentId();
    }

    if (getApiKey() && getEndpoint() && getDeploymentId()) {
        try {
            openai = new OpenAIClient(
                getEndpoint()!,
                new AzureKeyCredential(getApiKey()!)
            );
            await openai.getChatCompletions(getDeploymentId()!, [
                {
                    role: "user",
                    content: "I want to book a flight to Varanasi.",
                },
            ]);
        } catch (err) {
            vscode.window.showErrorMessage(
                "Azure Scribe AI: Error: " +
                    err +
                    "\n\nPlease check your API Key, Endpoint, and Deployment Name in your settings."
            );
            return false;
        }
    } else {
        const missingConfigs = [];
        if (!getApiKey()) {
            missingConfigs.push("API Key");
        }
        if (!getEndpoint()) {
            missingConfigs.push("Endpoint");
        }
        if (!getDeploymentId()) {
            missingConfigs.push("Deployment Name");
        }
        const formattedMissingConfigs = missingConfigs.join(", ");

        vscode.window.showWarningMessage(
            `Azure Scribe AI: [Warning] - The following configuration item(s) are not set: ${formattedMissingConfigs}. Please go to extension settings to set them.`
        );
    }
    vscode.window.showInformationMessage(
        "Azure Scribe AI: Successfully connected to Azure OpenAI API."
    );
    return true;
}

export async function activate(context: vscode.ExtensionContext) {
    await createAzureOpenAIClient();

    // A `CommentController` is able to provide comments for documents.
    const commentController = vscode.comments.createCommentController(
        "comment-azurescribeai",
        "Azure ScribeAI Comment Controller"
    );
    context.subscriptions.push(commentController);

    // A `CommentingRangeProvider` controls where gutter decorations that allow adding comments are shown
    commentController.commentingRangeProvider = {
        provideCommentingRanges: (
            document: vscode.TextDocument,
            token: vscode.CancellationToken
        ) => {
            const lineCount = document.lineCount;
            return [new vscode.Range(0, 0, lineCount - 1, 0)];
        },
    };

    commentController.options = {
        prompt: "Ask Azure Scribe AI...",
        placeHolder:
            'Ask me anything! Example: "Explain the above code in plain English"',
    };

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "mywiki.createNote",
            (reply: vscode.CommentReply) => {
                replyNote(reply);
            }
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "mywiki.askAI",
            (reply: vscode.CommentReply) => {
                vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: "Generating AI response...",
                        cancellable: true,
                    },
                    async () => {
                        await askAI(reply);
                    }
                );
            }
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "mywiki.aiEdit",
            (reply: vscode.CommentReply) => {
                vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: "Generating AI response...",
                        cancellable: true,
                    },
                    async () => {
                        await aiEdit(reply);
                    }
                );
            }
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "mywiki.genDocString",
            (reply: vscode.CommentReply) => {
                vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: "Generating AI response...",
                        cancellable: true,
                    },
                    async () => {
                        reply.text =
                            "Write a docstring for the above code and use syntax of the coding language to format it.";
                        await askAI(reply);
                    }
                );
            }
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "mywiki.replyNote",
            (reply: vscode.CommentReply) => {
                replyNote(reply);
            }
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "mywiki.deleteNoteComment",
            (comment: NoteComment) => {
                const thread = comment.parent;
                if (!thread) {
                    return;
                }

                thread.comments = thread.comments.filter(
                    (cmt) => (cmt as NoteComment).id !== comment.id
                );

                if (thread.comments.length === 0) {
                    thread.dispose();
                }
            }
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "mywiki.deleteNote",
            (thread: vscode.CommentThread) => {
                thread.dispose();
            }
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "mywiki.cancelsaveNote",
            (comment: NoteComment) => {
                if (!comment.parent) {
                    return;
                }

                comment.parent.comments = comment.parent.comments.map((cmt) => {
                    if ((cmt as NoteComment).id === comment.id) {
                        cmt.body = (cmt as NoteComment).savedBody;
                        cmt.mode = vscode.CommentMode.Preview;
                    }

                    return cmt;
                });
            }
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "mywiki.saveNote",
            (comment: NoteComment) => {
                if (!comment.parent) {
                    return;
                }

                comment.parent.comments = comment.parent.comments.map((cmt) => {
                    if ((cmt as NoteComment).id === comment.id) {
                        (cmt as NoteComment).savedBody = cmt.body;
                        cmt.mode = vscode.CommentMode.Preview;
                    }

                    return cmt;
                });
            }
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "mywiki.editNote",
            (comment: NoteComment) => {
                if (!comment.parent) {
                    return;
                }

                comment.parent.comments = comment.parent.comments.map((cmt) => {
                    if ((cmt as NoteComment).id === comment.id) {
                        cmt.mode = vscode.CommentMode.Editing;
                    }

                    return cmt;
                });
            }
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("mywiki.dispose", () => {
            commentController.dispose();
        })
    );

    /**
     * Generates the prompt to pass to OpenAI.
     * Prompt includes:
     * - Role play text that gives context to AI
     * - Code block highlighted for the comment thread
     * - All of past conversation history + example conversation
     * - User's new question
     * @param question
     * @param thread
     * @returns
     */
    async function generatePromptV1(
        question: string,
        thread: vscode.CommentThread
    ) {
        const rolePlay =
            "I want you to act as a highly intelligent AI chatbot that has deep understanding of any coding language and its API documentations. I will provide you with a code block and your role is to provide a comprehensive answer to any questions or requests that I will ask about the code block. Please answer in as much detail as possible and not be limited to brevity. It is very important that you provide verbose answers and answer in markdown format.";
        const codeBlock = await getCommentThreadCode(thread);

        let conversation =
            "Human: Who are you?\n\nAI: I am a intelligent AI chatbot\n\n";

        const filteredComments = thread.comments.filter(
            (comment) => comment.label !== "NOTE"
        );

        for (
            let i = Math.max(0, filteredComments.length - 8);
            i < filteredComments.length;
            i++
        ) {
            if (filteredComments[i].author.name === "VS Code") {
                conversation += `Human: ${
                    (filteredComments[i].body as vscode.MarkdownString).value
                }\n\n`;
            } else if (filteredComments[i].author.name === "Azure Scribe AI") {
                conversation += `AI: ${
                    (filteredComments[i].body as vscode.MarkdownString).value
                }\n\n`;
            }
        }
        conversation += `Human: ${question}\n\nAI: `;

        return rolePlay + "\n```\n" + codeBlock + "\n```\n\n\n" + conversation;
    }

    /**
     * Generates the prompt to pass to OpenAI ChatGPT API.
     * Prompt includes:
     * - Role play text that gives context to AI
     * - Code block highlighted for the comment thread
     * - All of past conversation history + example conversation
     * - User's new question
     * @param question
     * @param thread
     * @returns
     */
    async function generatePromptChatGPT(
        question: string,
        thread: vscode.CommentThread
    ) {
        const messages: ChatRequestMessage[] = [];
        const rolePlay =
            "I want you to act as a highly intelligent AI chatbot that has deep understanding of any coding language and its API documentations. I will provide you with a code block and your role is to provide a comprehensive answer to any questions or requests that I will ask about the code block. Please answer in as much detail as possible and not be limited to brevity. It is very important that you provide verbose answers and answer in markdown format.";
        const codeBlock = await getCommentThreadCode(thread);

        messages.push({
            role: "system",
            content: rolePlay + "\nCode:\n```\n" + codeBlock + "\n```",
        });
        messages.push({ role: "user", content: "Who are you?" });
        messages.push({
            role: "assistant",
            content: "I am a intelligent and helpful AI chatbot.",
        });

        const filteredComments = thread.comments.filter(
            (comment) => comment.label !== "NOTE"
        );

        for (
            let i = Math.max(0, filteredComments.length - 8);
            i < filteredComments.length;
            i++
        ) {
            if (filteredComments[i].author.name === "VS Code") {
                messages.push({
                    role: "user",
                    content: `${
                        (filteredComments[i].body as vscode.MarkdownString)
                            .value
                    }`,
                });
            } else if (filteredComments[i].author.name === "Azure Scribe AI") {
                messages.push({
                    role: "assistant",
                    content: `${
                        (filteredComments[i].body as vscode.MarkdownString)
                            .value
                    }`,
                });
            }
        }
        messages.push({ role: "user", content: `${question}` });

        return messages;
    }

    /**
     * Generates the prompt to pass to OpenAI.
     * Note: Not as performant as V1 but consumes less tokens per request.
     * Prompt includes:
     * - Role play text that gives context to AI
     * - Code block highlighted for the comment thread
     * - An example conversation to give the AI an example. "Human: Who are you?\nAI: I am a intelligent AI chatbot\n";
     * - User's new question
     * @param question
     * @param thread
     * @returns
     */
    function generatePromptV2(question: string, thread: vscode.CommentThread) {
        const rolePlay =
            "I want you to act as a highly intelligent AI chatbot that has deep understanding of any coding language and its API documentations. " +
            "I will provide you with a code block and your role is to provide a comprehensive answer to any questions or requests that I will ask about the code block. Please answer in as much detail as possible and not be limited to brevity. It is very important that you provide verbose answers. (When responding to the following prompt, please make sure to properly style your response using Github Flavored Markdown." +
            " Use markdown syntax for things like headings, lists, colored text, code blocks, highlights etc. Make sure not to mention markdown or stying in your actual response." +
            " Try to write code inside a single code block if possible)";
        const codeBlock = getCommentThreadCode(thread);

        let conversation =
            "Human: Who are you?\n\nAI: I am a intelligent AI chatbot\n\n";
        conversation += `Human: ${question}\n\nAI: `;
        return rolePlay + "\n" + codeBlock + "\n\n\n" + conversation;
    }

    /**
     * Gets the highlighted code for this comment thread
     * @param thread
     * @returns
     */
    async function getCommentThreadCode(thread: vscode.CommentThread) {
        const document = await vscode.workspace.openTextDocument(thread.uri);
        // Get selected code for the comment thread
        return document.getText(thread.range).trim();
    }

    async function getOpenAIResponse(prompt: ChatRequestMessage[]) {
        if (openai === undefined) {
            await createAzureOpenAIClient();
            if (openai === undefined) {
                vscode.window.showErrorMessage(
                    "Azure Scribe AI: OpenAI client creation failed"
                );
                return null;
            }
        }

        const options = {
            temperature: 0,
            maxTokens: 500,
            topP: 1.0,
            frequencyPenalty: 1,
            presencePenalty: 1,
        };

        try {
            const response = await openai!.getChatCompletions(
                getDeploymentId()!,
                prompt,
                options
            );
            return (
                response.choices[0].message?.content ||
                "Azure Scribe AI: An error occurred. Please try again..."
            );
        } catch (err) {
            vscode.window.showErrorMessage(
                "Error sending request to OpenAI: " + err
            );
            return null;
        }
    }

    /**
     * User replies with a question.
     * The question + conversation history + code block then gets used
     * as input to call the OpenAI API to get a response.
     * The new humna question and AI response then gets added to the thread.
     * @param reply
     */
    async function askAI(reply: vscode.CommentReply) {
        const question = reply.text.trim();
        const thread = reply.thread;
        let chatGPTPrompt: ChatRequestMessage[] = [];
        chatGPTPrompt = await generatePromptChatGPT(question, thread);
        const humanComment = new NoteComment(
            new vscode.MarkdownString(question),
            vscode.CommentMode.Preview,
            {
                name: "VS Code",
                iconPath: vscode.Uri.parse(
                    "https://img.icons8.com/fluency/96/null/user-male-circle.png"
                ),
            },
            thread,
            thread.comments.length ? "canDelete" : undefined
        );
        thread.comments = [...thread.comments, humanComment];

        const responseText = await getOpenAIResponse(chatGPTPrompt);
        const AIComment = new NoteComment(
            new vscode.MarkdownString(responseText!.trim()),
            vscode.CommentMode.Preview,
            {
                name: "Azure Scribe AI",
                iconPath: vscode.Uri.parse(
                    "https://img.icons8.com/fluency/96/null/chatbot.png"
                ),
            },
            thread,
            thread.comments.length ? "canDelete" : undefined
        );
        thread.comments = [...thread.comments, AIComment];
    }

    /**
     * AI will edit the highlighted code based on the given instructions.
     * Uses the OpenAI Edits endpoint. Replaces the highlighted code
     * with AI generated code. You can undo to go back.
     *
     * @param reply
     * @returns
     */
    async function aiEdit(reply: vscode.CommentReply) {
        const context: ChatRequestMessage = {
            role: "system",
            content:
                "You are an AI chatbot that has deep understanding of any coding language and its API documentations. I will provide you with a an instruction and then a code. Your role is to return the code modified according to the instructions. Return only the code, do not make any comment. The code should be usable as you return it.",
        };
        const instruction: ChatRequestMessage = {
            role: "user",
            content: reply.text.trim(),
        };
        const code: ChatRequestMessage = {
            role: "system",
            content: await getCommentThreadCode(reply.thread),
        };
        const thread = reply.thread;
        const prompt: ChatRequestMessage[] = [];
        prompt.push(context);
        prompt.push(instruction);
        prompt.push(code);

        const responseText = getOpenAIResponse(prompt);

        if (responseText) {
            const editor = await vscode.window.showTextDocument(thread.uri);
            if (!editor) {
                return; // No open text editor
            }
            editor.edit((editBuilder) => {
                editBuilder.replace(thread.range, responseText + "");
            });
        } else {
            vscode.window.showErrorMessage(
                "Azure Scribe AI: An error occured. Please try again..."
            );
        }
    }

    /**
     * Adds a regular note. Doesn't call OpenAI API.
     * @param reply
     */
    function replyNote(reply: vscode.CommentReply) {
        const thread = reply.thread;
        const newComment = new NoteComment(
            new vscode.MarkdownString(reply.text),
            vscode.CommentMode.Preview,
            {
                name: "VS Code",
                iconPath: vscode.Uri.parse(
                    "https://img.icons8.com/fluency/96/null/user-male-circle.png"
                ),
            },
            thread,
            thread.comments.length ? "canDelete" : undefined
        );
        newComment.label = "NOTE";
        thread.comments = [...thread.comments, newComment];
    }
}
