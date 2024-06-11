import { Router } from "express";
import dotnet from "dotenv";
import user from "../helpers/user.js";
import jwt from "jsonwebtoken";
import chat from "../helpers/chat.js";
import OpenAI, { toFile } from "openai";
import { db } from "../db/connection.js";
import collections from "../db/collections.js";
import multer from "multer";
import fs from "fs";
import { ObjectId } from "mongodb";
dotnet.config();

let router = Router();
const upload = multer({ dest: "uploads/" });

/*
Function Name: CheckUser
Task: Middleware to check if the user is authenticated
Details:
1. Verifies the JWT token from the req cookies.
2. If decoded, checks if the user exists in the database.
3. If user exists, sets userId in the request body and proceeds to the next middleware.
4. If user not found, clears the userToken cookie and returns a 405 status with an error message.
5. If an error occurs during user verification, returns a 500 status with the error message.
6. If the token is not decoded, returns a 405 status with a "Not Logged" message.
*/
const CheckUser = async (req, res, next) => {
  jwt.verify(
    req.cookies?.userToken,
    process.env.JWT_PRIVATE_KEY,
    async (err, decoded) => {
      if (decoded) {
        let userData = null;

        try {
          userData = await user.checkUserFound(decoded);
        } catch (err) {
          if (err?.notExists) {
            res.clearCookie("userToken").status(405).json({
              status: 405,
              message: err?.text,
            });
          } else {
            res.status(500).json({
              status: 500,
              message: err,
            });
          }
        } finally {
          if (userData) {
            req.body.userId = userData._id;
            next();
          }
        }
      } else {
        res.status(405).json({
          status: 405,
          message: "Not Logged",
        });
      }
    }
  );
};

const client = new OpenAI({
  apiKey: "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",
});
const openai = new OpenAI({
  apiKey: "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",
});

// Testing the API
router.get("/", (req, res) => {
  res.send("Welcome to chatGPT api v1");
});

/* 
  Route: GET /upload
  Description: Retrieves uploaded files for a specific chat.
  Cases:
    - If userToken cookie is provided and valid:
      - Retrieves files associated with the specified chat ID.
      - If chat exists:
        - Responds with status 200 and the file names.
      - If chat does not exist:
        - Responds with status 404 and a "Not found" message.
    - If userToken cookie is not provided:
      - Responds with status 405 and a "Not Logged" message.
*/
router.get("/upload", CheckUser, async (req, res) => {
  const { userId } = req.body;
  const { chatId } = req.query;
  let chat = await db.collection(collections.CHAT).findOne({
    user: userId.toString(),
    "data.chatId": chatId,
  });
  if (chat) {
    chat = chat.data.filter((obj) => {
      return obj.chatId === chatId;
    });
    chat = chat[0];
    res.status(200).json({
      status: 200,
      message: "Success",
      data: chat.file_name,
    });
  } else {
    res.status(404).json({
      status: 404,
      message: "Not found",
    });
  }
});

/*
  Route: POST /upload
  Description: Uploads a file, processes it with OpenAI, and stores relevant information in MongoDB.
  Cases:
    1. If userToken cookie is provided and valid:
       - Extracts userId and chatId from the request body.
       - Creates a readable stream from the uploaded file.
       - Attempts to upload the file to OpenAI.
       - If successful:
         - Retrieves the file ID and original filename.
         - Searches for the chat based on userId and chatId.
         - If the chat exists:
           - Updates the chat with the new file information and creates an assistant in OpenAI.
         - If the chat does not exist:
           - Creates a new chat and associates it with the user.
         - Responds with status 200 and a "Success" message along with the file ID, filename, and chat ID.
       - If any error occurs during the process:
         - Responds with status 500 and the error message.
    2. If userToken cookie is not provided:
       - Responds with status 405 and a "Not Logged" message.
*/

router.post("/upload", upload.single("file"), CheckUser, async (req, res) => {
  // take file object from frontend upload to openai and store id and file name to mongo db
  const { userId, chatId } = req.body;
  const file = fs.createReadStream(req ? req.file.path : null);
  let response = null;
  try {
    response = await client.files.create({
      purpose: "assistants",
      file: file,
    });
  } catch (err) {
    console.log(err);
    res.status(500).json({
      status: 500,
      message: err,
    });
    return; // Exit early in case of an error
  }
  // delete the file from the uploads folder after uploading to openai
  let file_id = null;
  let file_name = null;

  if (response) {
    file_id = response.id;
    file_name = req.file.originalname;

    let chatIdToSend = null; // Variable to store the chatId to send in the response

    const chat = await db
      .collection(collections.CHAT)
      .aggregate([
        {
          $match: {
            user: userId.toString(),
          },
        },
        {
          $unwind: "$data",
        },
        {
          $match: {
            "data.chatId": chatId,
          },
        },
        {
          $project: {
            files: "$data.files",
          },
        },
      ])
      .toArray();
    let all_files = [];
    if (chat[0]?.files?.length > 0) {
      all_files = [...chat[0].files, file_id];
    } else {
      all_files = [file_id];
    }
    const assistant = await client.beta.assistants.create({
      name: "GE CoPilot",
      instructions:
        "You are a helpful and that answers what is asked. Retrieve the relevant information from the files.",
      tools: [{ type: "retrieval" }, { type: "code_interpreter" }],
      model: "gpt-4-0125-preview",
      file_ids: all_files,
    });
    if (chat.length > 0) {
      chatIdToSend = chatId; // Use existing chatId
      await db.collection(collections.CHAT).updateOne(
        {
          user: userId.toString(),
          "data.chatId": chatId,
        },
        {
          $addToSet: {
            "data.$.files": file_id,
            "data.$.file_name": file_name,
          },
          $set: {
            "data.$.assistant_id": assistant.id,
          },
        }
      );
    } else {
      const newChatId = new ObjectId().toHexString();
      chatIdToSend = newChatId; // Use newly generated chatId
      await db.collection(collections.CHAT).updateOne(
        {
          user: userId.toString(),
        },
        {
          $push: {
            data: {
              chatId: newChatId,
              files: [file_id],
              file_name: [file_name],
              chats: [],
              chat: [],
              assistant_id: assistant.id,
            },
          },
        },
        {
          new: true,
          upsert: true,
        }
      );
    }

    res.status(200).json({
      status: 200,
      message: "Success",
      data: {
        file_id,
        file_name,
        chatId: chatIdToSend, // Send the correct chatId in the response
      },
    });
  }
});

/*
  Route: POST /
  Description: Generates a response to a prompt using OpenAI's chat model and stores the response in the database.
  Cases:
    1. If userToken cookie is provided and valid:
       - Extracts prompt and userId from the request body.
       - Initializes an empty response object.
       - Calls OpenAI's chat completions endpoint to generate a response to the prompt.
       - If successful:
         - Parses and cleans the response from OpenAI.
         - Stores the response in the database.
       - If any error occurs during the process:
         - Responds with status 500 and the error message.
    2. If userToken cookie is not provided:
       - Responds with status 405 and a "Not Logged" message.
*/

router.post("/", CheckUser, async (req, res) => {
  const { prompt, userId } = req.body;
  let response = {};
  try {
    console.log("POST is being called", req.body);
    // If no file_id is given
    response.openai = await openai.chat.completions.create({
      model: "gpt-4-0125-preview",
      messages: [
        {
          role: "system",
          content:
            "You are a helpful and that answers what is asked. Dont show the mathematical steps if not asked.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      top_p: 0.5,
    });
    if (response.openai.choices[0].message) {
      response.openai = response.openai.choices[0].message.content;
      let index = 0;
      for (let c of response["openai"]) {
        if (index <= 1) {
          if (c == "\n") {
            response.openai = response.openai.slice(1, response.openai.length);
          }
        } else {
          break;
        }
        index++;
      }
      response.db = await chat.newResponse(prompt, response, userId);
    }
  } catch (err) {
    console.log(err);
    res.status(500).json({
      status: 500,
      message: err,
    });
  } finally {
    if (response?.db && response?.openai) {
      res.status(200).json({
        status: 200,
        message: "Success",
        data: {
          _id: response.db["chatId"],
          content: response.openai,
        },
      });
    }
  }
});

/*
  Route: PUT /
  Description: Updates a chat with a user prompt, generates an assistant response using OpenAI, and stores the interaction in the database.
  Cases:
    1. If userToken cookie is provided and valid:
       - Extracts prompt, userId, and chatId from the request body.
       - Constructs a system message for OpenAI's chat model.
       - Retrieves previous chat messages for the specified chat.
       - Prepends the system message to the existing chat messages.
       - Retrieves the chat data from the database.
       - If an assistant ID is available:
         - Creates a new thread in OpenAI's Beta API.
         - Runs the thread with the assistant ID until completion.
         - Parses and stores the assistant's response.
       - If no assistant ID is available:
         - Calls OpenAI's chat completions endpoint to generate an assistant response.
         - Aggregates and cleans the response.
       - Stores the user prompt and assistant response in the database.
       - Responds with status 200 and the updated chat data.
    2. If userToken cookie is not provided:
       - Responds with status 405 and a "Not Logged" message.
*/

router.put("/", CheckUser, async (req, res) => {
  const { prompt, userId, chatId } = req.body;
  console.log("PUT is being called", req.body);
  let mes = {
    role: "system",
    content:
      "You are a helpful and that answers what is asked. Dont show the mathematical steps if not asked.",
  };
  let full = "";
  let message = await chat.Messages(userId, chatId);
  message = message[0].chats;
  mes = [mes, ...message];
  mes = [
    ...mes,
    {
      role: "user",
      content: prompt,
    },
  ];
  let response = {};
  let new_chat = await db.collection(collections.CHAT).findOne({
    user: userId.toString(),
    data: { $elemMatch: { chatId: chatId } },
  });
  new_chat = new_chat.data.filter((obj) => {
    return obj.chatId === chatId;
  });
  new_chat = new_chat[0];
  const assistant_id = new_chat.assistant_id;
  try {
    if (assistant_id) {
      console.log("Assistant running");

      const thread = await client.beta.threads.create({
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      });
      const run = await client.beta.threads.runs.create(thread.id, {
        assistant_id: assistant_id,
      });
      let final_run = "";
      while (final_run.status !== "completed") {
        final_run = await client.beta.threads.runs.retrieve(thread.id, run.id);
      }
      console.log(final_run.status);
      const messages = await client.beta.threads.messages.list(thread.id);
      response = { openai: messages.data[0].content[0].text.value };
      if (response.openai) {
        let index = 0;
        for (let c of response["openai"]) {
          if (index <= 1) {
            if (c == "\n") {
              response.openai = response.openai.slice(
                1,
                response.openai.length
              );
            }
          } else {
            break;
          }
          index++;
        }
        response.db = await chat.Response(
          prompt,
          response,
          userId,
          chatId,
          assistant_id
        );
      }
    } else {
      response.openai = await openai.chat.completions.create({
        model: "gpt-4-0125-preview",
        messages: mes,
        top_p: 0.52,
        stream: true,
      });
      for await (const part of response.openai) {
        let text = part.choices[0].delta.content ?? "";
        full += text;
      }
      response.openai = {
        role: "assistant",
        content: full,
      };
      if (response.openai) {
        response.openai = response.openai.content;
        let index = 0;
        for (let c of response["openai"]) {
          if (index <= 1) {
            if (c == "\n") {
              response.openai = response.openai.slice(
                1,
                response.openai.length
              );
            }
          } else {
            break;
          }
          index++;
        }
        response.db = await chat.Response(
          prompt,
          response,
          userId,
          chatId,
          assistant_id
        );
      }
    }
  } catch (err) {
    console.log(err);
    res.status(500).json({
      status: 500,
      message: err,
    });
  } finally {
    if (response?.db && response?.openai) {
      res.status(200).json({
        status: 200,
        message: "Success",
        data: {
          content: response.openai,
          chatId: response.db.chatId,
        },
      });
    }
  }
});

/*
  Route: GET /saved
  Description: Retrieves saved chat data for a user.
  Cases:
    1. If userToken cookie is provided and valid:
       - Extracts userId from the request body and chatId from the query parameters.
       - Initializes response as null.
       - Attempts to retrieve chat data from the database.
       - If successful:
         - Responds with status 200 and the retrieved chat data.
       - If chat data is not found:
         - Responds with status 404 and a "Not found" message.
       - If any other error occurs during the process:
         - Responds with status 500 and the error message.
    2. If userToken cookie is not provided:
       - Responds with status 405 and a "Not Logged" message.
*/

router.get("/saved", CheckUser, async (req, res) => {
  const { userId } = req.body;
  const { chatId = null } = req.query;

  let response = null;

  try {
    response = await chat.getChat(userId, chatId);
  } catch (err) {
    if (err?.status === 404) {
      res.status(404).json({
        status: 404,
        message: "Not found",
      });
    } else {
      res.status(500).json({
        status: 500,
        message: err,
      });
    }
  } finally {
    if (response) {
      res.status(200).json({
        status: 200,
        message: "Success",
        data: response,
      });
    }
  }
});

/*
  Route: GET /saved
  Description: Retrieves saved chat data for a user.
  Cases:
    1. If userToken cookie is provided and valid:
       - Extracts userId from the request body and chatId from the query parameters.
       - Initializes response as null.
       - Attempts to retrieve chat data from the database.
       - If successful:
         - Responds with status 200 and the retrieved chat data.
       - If chat data is not found:
         - Responds with status 404 and a "Not found" message.
       - If any other error occurs during the process:
         - Responds with status 500 and the error message.
    2. If userToken cookie is not provided:
       - Responds with status 405 and a "Not Logged" message.
*/

router.get("/history", CheckUser, async (req, res) => {
  const { userId } = req.body;

  let response = null;

  try {
    response = await chat.getHistory(userId);
  } catch (err) {
    res.status(500).json({
      status: 500,
      message: err,
    });
  } finally {
    if (response) {
      res.status(200).json({
        status: 200,
        message: "Success",
        data: response,
      });
    }
  }
});

/*
  Route: DELETE /all
  Description: Deletes all chat data for a user.
  Cases:
    1. If userToken cookie is provided and valid:
       - Extracts userId from the request body.
       - Initializes response as null.
       - Attempts to delete all chat data for the user.
       - If successful:
         - Responds with status 200 and a "Success" message.
       - If any error occurs during the process:
         - Responds with status 500 and the error message.
*/

router.delete("/all", CheckUser, async (req, res) => {
  const { userId } = req.body;

  let response = null;

  try {
    response = await chat.deleteAllChat(userId);
  } catch (err) {
    res.status(500).json({
      status: 500,
      message: err,
    });
  } finally {
    if (response) {
      res.status(200).json({
        status: 200,
        message: "Success",
      });
    }
  }
});

//Router for Attached Documnets Modal

/*
  Route: POST /getfile
  Description: Retrieves files associated with a specific chat for a user.
  Cases:
    1. If userToken cookie is provided and valid:
       - Extracts userId and chatId from the request body.
       - Initializes response as null.
       - Attempts to retrieve files associated with the specified chat for the user.
       - If successful:
         - Responds with status 200 and the retrieved files data.
       - If any error occurs during the process:
         - Responds with status 500 and the error message.
*/

router.post("/getfile", async (req, res) => {
  const { userId, chatId } = req.body;
  let response = null;

  try {
    response = await chat.getFiles(userId, chatId);
  } catch (err) {
    res.status(500).json({
      status: 500,
      message: err,
    });
  } finally {
    if (response) {
      res.status(200).json({
        status: 200,
        message: "Success",
        data: response,
      });
    }
  }
});

/*
  Route: POST /deletefile
  Description: Deletes a specific file associated with a chat for a user.
  Cases:
    1. If userToken cookie is provided and valid:
       - Extracts userId, chatId, and file_name from the request body.
       - Initializes response as null.
       - Attempts to retrieve the file ID associated with the specified file name and chat for the user.
       - If successful:
         - Deletes the file using the retrieved file ID.
         - Responds with status 200 and a "Success" message.
       - If any error occurs during the process:
         - Responds with status 500 and the error message.
*/

router.post("/deletefile", CheckUser, async (req, res) => {
  const { userId, chatId, file_name } = req.body;
  let response = null;

  try {
    const file_id_obj = await db
      .collection(collections.CHAT)
      .aggregate([
        {
          $match: {
            user: userId.toString(),
          },
        },
        {
          $unwind: "$data",
        },
        {
          $match: {
            "data.chatId": chatId,
          },
        },
        {
          $project: {
            data: 1,
            file_index: {
              $indexOfArray: ["$data.file_name", file_name],
            },
          },
        },
      ])
      .toArray();
    let file_id = file_id_obj[0]?.data?.files[file_id_obj[0]?.file_index];
    response = await chat.deleteFile(userId, chatId, file_name, file_id);
  } catch (err) {
    console.log(err);
    res.status(500).json({
      status: 500,
      message: err,
    });
  } finally {
    if (response) {
      res.status(200).json({
        status: 200,
        message: "Success",
      });
    }
  }
});

export default router;
