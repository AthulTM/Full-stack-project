import { db } from "../db/connection.js";
import collections from "../db/collections.js";
import bcrypt from "bcrypt";
import { ObjectId } from "mongodb";
import AWS from "aws-sdk";

const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
});
export default {
  /*
Function Name: signup
Task: Register a new user
Details:
1. Generates a new ObjectId for the user.
2. Checks if the provided email is already registered.
3. Hashes the password using bcrypt.
4. Inserts a new document into the TEMP collection with registration details.
5. Resolves with the user's ObjectId if successful, else rejects with an error message.
*/

  signup: ({ email, pass, manual, pending }) => {
    return new Promise(async (resolve, reject) => {
      let done = null;

      let userId = new ObjectId().toHexString();

      try {
        let check = await db.collection(collections.USER).findOne({
          email: email,
        });

        if (!check) {
          pass = await bcrypt.hash(pass, 10);

          await db
            .collection(collections.TEMP)
            .createIndex({ email: 1 }, { unique: true });
          await db
            .collection(collections.TEMP)
            .createIndex({ expireAt: 1 }, { expireAfterSeconds: 3600 });
          done = await db.collection(collections.TEMP).insertOne({
            _id: new ObjectId(userId),
            userId: `${userId}_register`,
            email: `${email}_register`,
            register: true,
            pass: pass,
            manual: manual,
            pending: pending,
            expireAt: new Date(),
          });
        }
      } catch (err) {
        if (err?.code === 11000) {
          done = await db
            .collection(collections.TEMP)
            .findOneAndUpdate(
              {
                email: `${email}_register`,
                register: true,
              },
              {
                $set: {
                  pass: pass,
                  manual: manual,
                },
              }
            )
            .catch((err) => {
              reject(err);
            });
        } else if (err?.code === 85) {
          done = await db
            .collection(collections.TEMP)
            .insertOne({
              _id: new ObjectId(userId),
              userId: `${userId}_register`,
              email: `${email}_register`,
              pass: pass,
              manual: manual,
              pending: pending,
              expireAt: new Date(),
            })
            .catch(async (err) => {
              if (err?.code === 11000) {
                done = await db
                  .collection(collections.TEMP)
                  .findOneAndUpdate(
                    {
                      email: `${email}_register`,
                      register: true,
                    },
                    {
                      $set: {
                        pass: pass,
                        manual: manual,
                      },
                    }
                  )
                  .catch((err) => {
                    reject(err);
                  });
              } else {
                reject(err);
              }
            });
        } else {
          reject(err);
        }
      } finally {
        if (done?.value) {
          resolve({ _id: done?.value?._id.toString(), manual });
        } else if (done?.insertedId) {
          resolve({ _id: done?.insertedId?.toString(), manual });
        } else {
          reject({ exists: true, text: "Email already used" });
        }
      }
    });
  },

  /*
Function Name: checkPending
Task: Check if a user registration is pending
Details:
1. Checks if the user is already registered in the USER collection.
2. If not found, checks if registration details exist in the TEMP collection.
3. Resolves with the registration details if pending, else rejects with an error message.
*/

  checkPending: (_id) => {
    return new Promise(async (resolve, reject) => {
      let data = await db
        .collection(collections.USER)
        .findOne({
          _id: new ObjectId(_id),
        })
        .catch((err) => {
          reject(err);
        });

      if (data) {
        reject({ status: 422, text: "Already registered" });
      } else {
        let check = null;

        try {
          check = await db.collection(collections.TEMP).findOne({
            _id: new ObjectId(_id),
          });
        } catch (err) {
          reject(err);
        } finally {
          if (check) {
            delete check.pass;
            resolve(check);
          } else {
            reject({ status: 404, text: "Not Found" });
          }
        }
      }
    });
  },

  /*
Function Name: finishSignup
Task: Complete the user registration process
Details:
1. Retrieves registration details from the TEMP collection.
2. Removes the '_register' suffix from the email.
3. Inserts a new document into the USER collection with user details.
4. Deletes the registration details from the TEMP collection.
5. Resolves if successful, else rejects with an error message.
*/

  finishSignup: ({ fName, lName, _id }) => {
    return new Promise(async (resolve, reject) => {
      let data = await db
        .collection(collections.TEMP)
        .findOne({
          _id: new ObjectId(_id),
        })
        .catch((err) => {
          reject(err);
        });

      if (data) {
        let { pass, email } = data;
        email = email.replace("_register", "");

        let res = null;
        try {
          await db
            .collection(collections.USER)
            .createIndex({ email: 1 }, { unique: true });
          res = await db.collection(collections.USER).insertOne({
            _id: new ObjectId(_id),
            email: email,
            fName: fName,
            lName: lName,
            pass: pass,
            profile: "",
          });
        } catch (err) {
          if (err?.code === 11000) {
            reject({ status: 422 });
          } else {
            reject(err);
          }
        } finally {
          if (res?.insertedId) {
            await db
              .collection(collections.TEMP)
              .deleteOne({
                _id: new ObjectId(_id),
              })
              .catch((err) => {
                console.log(err);
              });

            resolve(res);
          } else {
            reject({ text: "Something Wrong" });
          }
        }
      } else {
        reject({ text: "Something Wrong" });
      }
    });
  },

  /*
Function Name: login
Task: Authenticate user login
Details:
1. Finds the user document by email.
2. If found, checks the password using bcrypt.
3. Resolves with user details if authentication is successful, else rejects with an error message.
*/

  login: ({ email, pass, manual }) => {
    return new Promise(async (resolve, reject) => {
      let user = await db
        .collection(collections.USER)
        .findOne({ email: email })
        .catch((err) => {
          reject(err);
        });

      if (user) {
        if (manual === "false") {
          delete user.pass;
          resolve(user);
        } else {
          let check;
          try {
            check = await bcrypt.compare(pass, user.pass);
          } catch (err) {
            reject(err);
          } finally {
            if (check) {
              delete user.pass;
              resolve(user);
            } else {
              reject({
                status: 422,
              });
            }
          }
        }
      } else {
        reject({
          status: 422,
        });
      }
    });
  },

  /*
Function Name: forgotRequest
Task: Initiate the forgot password process
Details:
1. Finds the user document by email.
2. Inserts a new document into the TEMP collection with reset details.
3. Resolves with the reset secret if successful, else rejects with an error message.
*/

  forgotRequest: ({ email }, secret) => {
    return new Promise(async (resolve, reject) => {
      let user = await db
        .collection(collections.USER)
        .findOne({ email: email })
        .catch((err) => reject(err));

      if (user) {
        let done = null;

        try {
          await db
            .collection(collections.TEMP)
            .createIndex({ userId: 1 }, { unique: true });
          await db
            .collection(collections.TEMP)
            .createIndex({ expireAt: 1 }, { expireAfterSeconds: 3600 });
          done = await db.collection(collections.TEMP).insertOne({
            userId: user._id.toString(),
            email: email,
            secret: secret,
            expireAt: new Date(),
          });
        } catch (err) {
          if (err?.code === 11000) {
            secret = await db
              .collection(collections.TEMP)
              .findOneAndUpdate(
                {
                  email: email,
                },
                {
                  $set: {
                    userId: user._id.toString(),
                  },
                }
              )
              .catch((err) => {
                reject(err);
              });

            if (secret) {
              secret.value.userId = user._id.toString();
              secret = secret.value;
              done = true;
            }
          } else if (err?.code === 85) {
            done = await db
              .collection(collections.TEMP)
              .insertOne({
                userId: user._id.toString(),
                email: email,
                secret: secret,
                expireAt: new Date(),
              })
              .catch(async (err) => {
                if (err?.code === 11000) {
                  secret = await db
                    .collection(collections.TEMP)
                    .findOneAndUpdate(
                      {
                        email: email,
                      },
                      {
                        $set: {
                          userId: user._id.toString(),
                        },
                      }
                    )
                    .catch((err) => {
                      reject(err);
                    });

                  if (secret) {
                    secret.value.userId = user._id.toString();
                    secret = secret.value;
                    done = true;
                  }
                } else {
                  reject(err);
                }
              });
          } else {
            reject(err);
          }
        } finally {
          if (done) {
            if (typeof secret === "object") {
              resolve({ secret: secret?.secret, _id: user?._id });
            } else {
              resolve({ secret, _id: user?._id });
            }
          }
        }
      } else {
        reject({ status: 422 });
      }
    });
  },

  /*
Function Name: resetPassword
Task: Reset user password
Details:
1. Validates the reset secret.
2. Hashes the new password using bcrypt.
3. Updates the user's password in the USER collection.
4. Deletes the reset details from the TEMP collection.
5. Resolves if successful, else rejects with an error message.
*/

  resetPassword: ({ newPass, userId, secret }) => {
    return new Promise(async (resolve, reject) => {
      let checkSecret = db
        .collection(collections.TEMP)
        .findOne({
          userId: userId,
          secret: secret,
        })
        .catch((err) => {
          reject(err);
        });
      let done = null;

      if (checkSecret) {
        try {
          newPass = await bcrypt.hash(newPass, 10);
          done = await db.collection(collections.USER).updateOne(
            {
              _id: new ObjectId(userId),
            },
            {
              $set: {
                pass: newPass,
              },
            }
          );
        } catch (err) {
          reject(err);
        } finally {
          if (done?.modifiedCount > 0) {
            await db
              .collection(collections.TEMP)
              .deleteOne({
                userId: userId,
              })
              .catch((err) => {
                console.log(err);
              });

            resolve(done);
          } else {
            reject({ text: "Something Wrong" });
          }
        }
      } else {
        reject({ status: 404 });
      }
    });
  },

  /*
Function Name: checkForgot
Task: Check if forgot password request is valid
Details:
1. Finds the reset details in the TEMP collection.
2. Validates if the user exists in the USER collection.
3. Resolves with the reset details if valid, else rejects with an error message.
*/

  checkForgot: ({ userId, secret }) => {
    return new Promise(async (resolve, reject) => {
      let check = await db
        .collection(collections.TEMP)
        .findOne({
          userId: userId,
          secret: secret,
        })
        .catch((err) => {
          reject(err);
        });

      let user = await db
        .collection(collections.USER)
        .findOne({
          _id: new ObjectId(userId),
        })
        .catch((err) => {
          reject(err);
        });

      if (check && user) {
        resolve(check);
      } else {
        reject({ status: 404 });
      }
    });
  },

  /*
Function Name: checkUserFound
Task: Check if a user exists
Details:
1. Finds the user document by ObjectId.
2. Resolves with the user details if found, else rejects with an error message.
*/

  checkUserFound: ({ _id }) => {
    return new Promise(async (resolve, reject) => {
      let user = await db
        .collection(collections.USER)
        .findOne({ _id: new ObjectId(_id) })
        .catch((err) => {
          console.log(err);
          reject(err);
        });

      if (user) {
        resolve(user);
      } else {
        reject({ notExists: true, text: "Not found" });
      }
    });
  },

  /*
Function Name: deleteUser
Task: Delete a user and associated data
Details:
1. Deletes the user document from the USER collection.
2. Deletes associated chat data.
3. Resolves if successful, else rejects with an error message.
*/

  deleteUser: (userId) => {
    return new Promise((resolve, reject) => {
      db.collection(collections.USER)
        .deleteOne({
          _id: userId,
        })
        .then(async (res) => {
          if (res?.deletedCount > 0) {
            await db
              .collection(collections.CHAT)
              .deleteOne({
                user: userId.toString(),
              })
              .catch((err) => {
                console.log(err);
              });

            resolve(res);
          } else {
            reject({ text: "DB Getting Something Error" });
          }
        })
        .catch((err) => {
          reject(err);
        });
    });
  },

  /*
Function Name: updateUserProfile
Task: Update user profile details
Details:
1. Finds the user document by email.
2. Updates the user's first name and last name.
3. Resolves if successful, else rejects with an error message.
*/

  updateUserProfile: (email, firstName, lastName, image) => {
    return new Promise(async (resolve, reject) => {
      let check = db
        .collection(collections.USER)
        .findOne({
          email: email,
        })
        .catch((err) => {
          reject(err);
        });
      let done = null;

      if (check) {
        try {
          done = await db.collection(collections.USER).updateOne(
            { email },
            {
              $set: {
                fName: firstName,
                lName: lastName,
              },
            }
          );
        } catch (err) {
          reject(err);
        } finally {
          if (done?.modifiedCount > 0) {
            console.log("!").catch((err) => {
              console.log(err);
            });

            resolve(done);
          } else {
            reject({ text: "Something Wrong" });
          }
        }
      } else {
        reject({ status: 404 });
      }
    });
  },

  /*
Function Name: updateUserProfile1
Task: Update user profile with profile picture
Details:
1. Finds the user document by email.
2. Updates the user's first name and last name.
3. Uploads the profile picture to AWS S3 if provided.
4. Updates the user document with the profile picture URL.
5. Resolves if successful, else rejects with an error message.
*/

  updateUserProfile1: (email, firstName, lastName, image) => {
    return new Promise((resolve, reject) => {
      db.collection(collections.USER)
        .findOne({ email })
        .then((existingUser) => {
          if (existingUser) {
            if (firstName != "" && lastName != "")
              return db.collection(collections.USER).updateOne(
                { email },
                {
                  $set: {
                    fname: firstName,
                    lname: lastName,
                  },
                }
              );
          }
        })
        .then(() => {
          if (image) {
            const uploadParams = {
              Bucket: process.env.S3_BUCKET_NAME,
              Key: `${email}-${Date.now()}`, // Unique key for the image
              Body: image.data, // Assuming image is a buffer
              ACL: "public-read", // Make the image publicly accessible
            };
            return s3.upload(uploadParams).promise();
          } else {
            return Promise.resolve(); // Return a resolved promise if no image is present
          }
        })
        .then((uploadResult) => {
          if (uploadResult) {
            return db.collection(collections.USER).updateOne(
              { email },
              {
                $set: {
                  profilePicture: uploadResult.Location, // Store the URL of the uploaded image
                },
              }
            );
          }
        })
        .then(() => {
          resolve({ success: true });
        })
        .catch((error) => {
          console.error("Error updating user profile:", error);
          reject({ success: false, error: "Error updating user profile" });
        });
    });
  },
};
