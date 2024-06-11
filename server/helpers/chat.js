import { db } from "../db/connection.js";
import collections from "../db/collections.js";
import { ObjectId } from "mongodb";
import OpenAI from "openai";

export default {
  /*
Function Name: newResponse
Task: Add a new response to the chat data for a user
Details:
1. Generates a unique chatId for the new response.
2. Tries to create an index on the collection to ensure uniqueness based on the user.
3. Constructs a data object containing the chatId and the conversation details.
4. Inserts the data object into the database collection.
5. If a duplicate key error occurs (due to existing chatId for the user), updates the existing chat data.
6. Resolves with the updated chatId if successful, else rejects with an error message.
*/
  newResponse: (prompt, { openai }, userId) => {
    return new Promise(async (resolve, reject) => {
      let chatId = new ObjectId().toHexString();
      let res = null;
      try {
        await db
          .collection(collections.CHAT)
          .createIndex({ user: 1 }, { unique: true });
        let dataObj = {
          chatId,
          chats: [
            {
              role: "user",
              content: prompt,
            },
            {
              role: "assistant",
              content: openai,
            },
          ],
          chat: [
            {
              prompt: prompt,
              content: openai,
            },
          ],
        };

        res = await db.collection(collections.CHAT).insertOne({
          user: userId.toString(),
          data: [dataObj],
        });
      } catch (err) {
        if (err?.code === 11000) {
          let updateQuery = {
            user: userId.toString(),
          };
          let pushQuery = {
            $push: {
              data: {
                chatId,
                chats: [
                  {
                    role: "user",
                    content: prompt,
                  },
                  {
                    role: "assistant",
                    content: openai,
                  },
                ],
                chat: [
                  {
                    prompt: prompt,
                    content: openai,
                  },
                ],
              },
            },
          };

          res = await db
            .collection(collections.CHAT)
            .updateOne(updateQuery, pushQuery);
        } else {
          reject(err);
        }
      } finally {
        if (res) {
          res.chatId = chatId;
          resolve(res);
        } else {
          reject({ text: "DB gets something wrong" });
        }
      }
    });
  },
  /*
Function Name: Response
Task: Update an existing chat with a new response
Details:
1. Constructs an update object to push new chats and chat prompt/content into the existing chat data.
2. If file_name is provided, adds it to the chat data if not already present.
3. If assistant_id is provided, updates it in the chat data.
4. Executes the update operation on the database collection.
5. Resolves with the updated chatId if successful, else rejects with an error message.
*/
  Response: (prompt, { openai }, userId, chatId, assistant_id, file_name) => {
    return new Promise(async (resolve, reject) => {
      let res = null;
      try {
        let updateObj = {
          $push: {
            "data.$.chats": {
              $each: [
                { role: "user", content: prompt },
                { role: "assistant", content: openai },
              ],
            },
            "data.$.chat": {
              prompt: prompt,
              content: openai,
            },
          },
        };
        // If file_name is not empty and not already present in the array, push it
        if (file_name && file_name.trim() !== "") {
          updateObj.$addToSet = {
            "data.$.file_name": file_name,
          };
        }
        // If assistant_id is null, set it to the incoming assistant_id
        if (assistant_id !== null) {
          updateObj.$set = {
            "data.$.assistant_id": assistant_id,
          };
        }

        // Execute the update operation
        res = await db.collection(collections.CHAT).updateOne(
          {
            user: userId.toString(),
            "data.chatId": chatId,
          },
          updateObj
        );
      } catch (err) {
        reject(err);
      } finally {
        if (res) {
          res.chatId = chatId;
          resolve(res);
        } else {
          reject({ text: "DB gets something wrong" });
        }
      }
    });
  },
  /*
Function Name: updateChat
Task: Update an existing chat with a new message
Details:
1. Pushes the new message (prompt and assistant response) into the existing chat data.
2. Executes the update operation on the database collection.
3. Resolves with the updated chatId if successful, else rejects with an error message.
*/
  updateChat: (chatId, prompt, { openai }, userId) => {
    return new Promise(async (resolve, reject) => {
      let res = await db
        .collection(collections.CHAT)
        .updateOne(
          {
            user: userId.toString(),
            "data.chatId": chatId,
          },
          {
            $push: {
              data: {
                chatId,
                chats: [
                  {
                    role: "user",
                    content: prompt,
                  },
                  {
                    role: "assistant",
                    content: openai,
                  },
                ],
              },
            },
          }
        )
        .catch((err) => {
          reject(err);
        });

      if (res) {
        resolve(res);
      } else {
        reject({ text: "DB gets something wrong" });
      }
    });
  },

  /*
Function Name: getChat
Task: Retrieve a specific chat for a user
Details:
1. Aggregates to match the user and the specified chatId.
2. Projects the chat data from the matched document.
3. Resolves with the chat data if found, else rejects with a 404 status error.
*/
  getChat: (userId, chatId) => {
    return new Promise(async (resolve, reject) => {
      let res = await db
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
              _id: 0,
              chat: "$data.chat",
            },
          },
        ])
        .toArray()
        .catch((err) => [reject(err)]);

      if (res && Array.isArray(res) && res[0]?.chat) {
        resolve(res[0].chat);
      } else {
        reject({ status: 404 });
      }
    });
  },

  /*
Function Name: getHistory
Task: Retrieve the entire chat history for a user
Details:
1. Aggregates to match the user and unwind the chat data.
2. Projects the chatId and the entire chat array.
3. Resolves with the chat history array if successful, else rejects with an error message.
*/
  getHistory: (userId) => {
    return new Promise(async (resolve, reject) => {
      let res = await db
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
            $project: {
              _id: 0,
              chatId: "$data.chatId",
              chat: "$data.chat", // Project the entire 'chats' array
            },
          },
        ])
        .toArray()
        .catch((err) => {
          reject(err);
        });

      if (Array.isArray(res)) {
        resolve(res);
      } else {
        reject({ text: "DB Getting Some Error" });
      }
    });
  },
  /*
Function Name: deleteAllChat
Task: Delete all chats for a user
Details:
1. Deletes all documents matching the user from the database collection.
2. Resolves if deletion is successful, else rejects with an error message.
*/
  deleteAllChat: (userId) => {
    return new Promise((resolve, reject) => {
      db.collection(collections.CHAT)
        .deleteOne({
          user: userId.toString(),
        })
        .then((res) => {
          if (res?.deletedCount > 0) {
            resolve(res);
          } else {
            reject({ text: "DB Getting Some Error" });
          }
        })
        .catch((err) => {
          reject(err);
        });
    });
  },

  /*
Function Name: Messages
Task: Retrieve all messages for a specific chat
Details:
1. Aggregates to match the user and the specified chatId.
2. Projects the entire chats array from the matched document.
3. Resolves with the chat messages array if successful, else rejects with an error message.
*/

  //Get all message for OpenAI History
  Messages: (userId, chatId) => {
    return new Promise(async (resolve, reject) => {
      let res = await db
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
              _id: 0,
              chats: "$data.chats", // Project the entire 'chats' array
            },
          },
        ])
        .toArray()
        .catch((err) => {
          reject(err);
        });

      if (Array.isArray(res)) {
        resolve(res);
      } else {
        reject({ text: "DB Getting Some Error" });
      }
    });
  },

  /*
Function Name: getFiles
Task: Retrieve all file names associated with a specific chat
Details:
1. Aggregates to match the user and the specified chatId.
2. Projects the file names array from the matched document.
3. Resolves with the file names array if successful, else rejects with an error message.
*/
  //Get all file name
  getFiles: (userId, chatId) => {
    return new Promise(async (resolve, reject) => {
      let res = await db
        .collection(collections.CHAT)
        .aggregate([
          {
            $match: {
              user: userId,
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
              _id: 0,
              file_name: "$data.file_name", // Project the entire 'FileName' array
            },
          },
        ])
        .toArray()
        .catch((err) => {
          reject(err);
        });

      if (Array.isArray(res)) {
        resolve(res);
      } else {
        reject({ text: "DB Getting Some Error" });
      }
    });
  },

  /*
Function Name: deleteFile
Task: Delete a file from a specific chat and update the assistant
Details:
1. Removes the specified file name and file id from the chat data.
2. Retrieves the remaining file ids associated with the chat.
3. If no files remain, updates the assistant to null, otherwise updates the assistant with the remaining file ids.
4. Executes the update operation on the database collection.
5. Resolves if successful, else rejects with an error message.
*/
  deleteFile: (userId, chatId, file_name, file_id) => {
    const client = new OpenAI({
      apiKey: "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",
    });
    return new Promise(async (resolve, reject) => {
      try {
        const result = await db.collection(collections.CHAT).updateOne(
          {
            user: userId.toString(),
            "data.chatId": chatId,
          },
          {
            $pull: {
              "data.$.file_name": file_name,
              "data.$.files": file_id,
            },
          }
        );
        const files_data = await db
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
                _id: 0,
                file_id: "$data.files",
              },
            },
          ])
          .toArray();
        let assistant = null;
        if (files_data[0]?.file_id?.length === 0) {
          assistant = {
            id: null,
          };
        } else {
          assistant = await client.beta.assistants.create({
            name: "GE CoPilot",
            instructions:
              "You are a helpful and that answers what is asked. Retrieve the relevant information from the files.",
            tools: [{ type: "retrieval" }, { type: "code_interpreter" }],
            model: "gpt-4-0125-preview",
            file_ids: files_data[0]?.file_id,
          });
        }
        const result_chat_update = await db
          .collection(collections.CHAT)
          .updateOne(
            {
              user: userId.toString(),
              "data.chatId": chatId,
            },
            {
              $set: {
                "data.$.assistant_id": assistant.id,
              },
            }
          );
        if (result_chat_update.modifiedCount === 0) {
          reject({ text: "No matching documents found" });
          return;
        }
        resolve(result);
      } catch (err) {
        reject(err); // Reject with the caught error
      }
    });
  },
};
