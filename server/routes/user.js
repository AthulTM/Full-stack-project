import { Router } from "express";
import { db } from "./../db/connection.js";
import collections from "../db/collections.js";
import { ObjectId } from "mongodb";
import nodemailer from "nodemailer";
import sendMail from "../mail/send.js";
import user from "../helpers/user.js";
import jwt from "jsonwebtoken";
import axios from "axios";
import fs from "fs";
import path from "path";
let router = Router();

/*
Function Name: CheckLogged
Task: Middleware to check if the user is already logged in
Details:
1. Retrieves the JWT token from the request cookies.
2. Verifies the token using the JWT_PRIVATE_KEY.
3. If decoded, checks if the user exists in the database.
4. If user exists, sends a response indicating that the user is already logged in.
5. If user not found, clears the userToken cookie and proceeds to the next middleware.
6. If an error occurs during user verification, returns a 500 status with the error message.
7. If the token is not decoded, proceeds to the next middleware.
*/

const CheckLogged = async (req, res, next) => {
  const token = req.cookies.userToken;

  jwt.verify(token, process.env.JWT_PRIVATE_KEY, async (err, decoded) => {
    if (decoded) {
      let userData = null;

      try {
        userData = await user.checkUserFound(decoded);
      } catch (err) {
        if (err?.notExists) {
          res.clearCookie("userToken");
          next();
        } else {
          res.status(500).json({
            status: 500,
            message: err,
          });
        }
      } finally {
        if (userData) {
          delete userData.pass;
          res.status(208).json({
            status: 208,
            message: "Already Logged",
            data: userData,
          });
        }
      }
    } else {
      next();
    }
  });
};

/* 
  Route: POST /update_profile
  Description: Updates user profile information.
  Parameters: email, firstName, lastName, profilePicture from Body
  Task: -- Update user profile information in the database.
         (email, firstName, lastName, profilePicture)
  Other: used $set constarint to update each field of database
*/

router.post("/update_profile", async (req, res) => {
  const { email, firstName, lastName, profilePicture } = req.body;
  const done = await db.collection(collections.USER).updateOne(
    { email },
    {
      $set: {
        fName: firstName,
        lName: lastName,
        profilePicture: profilePicture,
      },
    }
  );
});

/* 
  Route: GET /checkLogged
  Description: Checks if the user is logged in.
  Parameters: None
  Middleware: CheckLogged - Middleware function to handle user authentication.
  Cases from Middleware:
    1. If user is logged in:
       - Continue to the next middleware or route.
    2. If user is not logged in:
       - Respond with status 405 and a "Not Logged" message.
*/

router.get("/checkLogged", CheckLogged, (req, res) => {
  res.status(405).json({
    status: 405,
    message: "Not Logged",
  });
});

/* 
  Route: POST /signup
  Description: Signup the User
  Parameters: None
  Cases:
    1. If manual signup is required:
       - If all required fields are provided:
         - Create a pending user profile in the database.
         - Send a verification email to the user.
       - On success:
         - Respond with status 200 and a "Success" message.
         - If manual signup is not required, continue to next middleware.
       - On failure:
         - If user already exists, respond with status 400 and the corresponding message.
         - For other errors, respond with status 500 and the error message.
    2. If OAuth signup:
       - Verify the OAuth token and check if the email is verified.
       - If verified and email matches:
         - Proceed with signup.
       - On failure:
         - Respond with status 500 and the error message.
    3. If manual signup without OAuth:
       - Validate email and password.
       - If valid:
         - Proceed with signup.
       - On failure:
         - Respond with status 422 and the corresponding message.
*/

router.post("/signup", CheckLogged, async (req, res) => {
  const Continue = async () => {
    let response = null;
    req.body.pending = true;

    try {
      response = await user.signup(req.body);
    } catch (err) {
      if (err?.exists) {
        res.status(400).json({
          status: 400,
          message: err,
        });
      } else {
        res.status(500).json({
          status: 500,
          message: err,
        });
      }
    } finally {
      if (response?.manual) {
        fs.readFile(
          `${path.resolve(path.dirname(""))}/mail/template.html`,
          "utf8",
          (err, html) => {
            if (!err) {
              html = html.replace(
                "[URL]",
                `${process.env.SITE_URL}/signup/pending/${response._id}`
              );
              html = html.replace("[TITLE]", "Verify your email address");
              html = html.replace(
                "[CONTENT]",
                "To continue setting up your GE CoPilot™ account, please verify that this is your email address."
              );
              html = html.replace("[BTN_NAME]", "Verify email address");

              sendMail({
                to: req.body.email,
                subject: `GE CoPilot™ - Verify your email`,
                html,
              });
            } else {
              console.log(err);
            }
          }
        );

        res.status(200).json({
          status: 200,
          message: "Success",
          data: {
            _id: null,
            manual: response.manual || false,
          },
        });
      } else if (response) {
        res.status(200).json({
          status: 200,
          message: "Success",
          data: {
            _id: response._id,
            manual: response.manual || false,
          },
        });
      }
    }
  };

  if (req.body?.manual === false) {
    let response = null;
    try {
      response = await axios.get(
        "https://www.googleapis.com/oauth2/v3/userinfo",
        {
          headers: {
            Authorization: `Bearer ${req.body.token}`,
          },
        }
      );
    } catch (err) {
      res.status(500).json({
        status: 500,
        message: err,
      });
    } finally {
      if (response?.data.email_verified) {
        if (req.body?.email === response?.data.email) {
          Continue();
        } else {
          res.status(422).json({
            status: 422,
            message: "Something Wrong",
          });
        }
      }
    }
  } else if (req.body?.email) {
    if (req.body?.pass.length >= 8) {
      req.body.email = req.body.email.toLowerCase();

      Continue();
    } else {
      res.status(422).json({
        status: 422,
        message: "Password must 8 character",
      });
    }
  } else {
    res.status(422).json({
      status: 422,
      message: "Enter email",
    });
  }
});

/* 
/* 
  Route: GET /checkPending
  Description: Checks pending requests.
  Middleware: CheckLogged - Middleware function to handle user authentication.
  Parameters from Query:
    - _id: User ID (String)
  Cases:
    1. If _id is provided and valid (length is 24):
       - Finds the user by _id in the user collection.
       - If user is found:
         - Responds with status 422 and an "Already registered" message.
       - If user is not found:
         - Finds the corresponding record in the temporary collection.
         - If the record exists:
           - Removes the password field from the record.
           - Responds with status 200, a "Success" message, and the data.
         - If the record does not exist:
           - Responds with status 404 and a "Not Found" message.
       - If any error occurs during the process:
         - Responds with the appropriate status code and error message.
    2. If _id is not provided or invalid:
       - Responds with status 404 and a "Not found" message.
*/

router.get("/checkPending", CheckLogged, async (req, res) => {
  const { _id } = req.query;
  let response = null;
  if (_id?.length === 24) {
    try {
      response = await user.checkPending(_id);
    } catch (err) {
      if (err?.status === 422) {
        res.status(422).json({
          status: 422,
          message: err?.text,
        });
      } else if (err?.status === 404) {
        res.status(404).json({
          status: 404,
          message: err?.text,
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
  } else {
    res.status(404).json({
      status: 404,
      message: "Not found",
    });
  }
});

/* 
  Route: PUT /signup-finish
  Description: Completes the signup process.
  Middleware: CheckLogged - Middleware function to handle user authentication.
  Cases:
    1. If the signup process is successfully completed:
       - Responds with status 200 and a "Success" message along with the data.
    2. If the user is already registered:
       - Responds with status 422 and an "Already Registered" message.
    3. If an error occurs during the signup process:
       - Responds with status 500 and the error message.
*/

router.put("/signup-finish", CheckLogged, async (req, res) => {
  let response = null;
  try {
    response = await user.finishSignup(req.body);
  } catch (err) {
    if (err?.status === 422) {
      res.status(422).json({
        status: 422,
        message: "Already Registered",
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
  Route: GET /login
  Description: Handles user login, supporting both manual login and OAuth2 login.
  Parameters:
    - email: User's email address.
    - pass: User's password (for manual login).
    - manual: Flag indicating whether the login is manual or not.
    - token: OAuth2 token (for non-manual login).
  Cases:
    - If login is not manual and email verification is successful:
       - Proceed with login using OAuth2 token.
       - On success:
         - Respond with status 200 and a "Success" message along with user data.
       - On failure:
         - Respond with status 500 and the error message.
    - If login is manual and both email and password are provided:
       - Proceed with manual login.
       - On success:
         - Respond with status 200 and a "Success" message along with user data.
       - On failure:
         - If email or password is incorrect, respond with status 422 and the corresponding message.
         - For other errors, respond with status 500 and the error message.
    - If login is neither manual nor email verification fails:
       - Respond with status 422 and the corresponding message.
*/

router.get("/login", CheckLogged, async (req, res) => {
  const Continue = async () => {
    let response = null;
    try {
      response = await user.login(req.query);
    } catch (err) {
      if (err?.status === 422) {
        res.status(422).json({
          status: 422,
          message: "Email or password wrong",
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
  };

  if (req.query?.manual === "false") {
    let response = null;
    try {
      response = await axios.get(
        "https://www.googleapis.com/oauth2/v3/userinfo",
        {
          headers: {
            Authorization: `Bearer ${req.query.token}`,
          },
        }
      );
    } catch (err) {
      res.status(500).json({
        status: 500,
        message: err,
      });
    } finally {
      if (response?.data.email_verified) {
        req.query.email = response?.data.email;
        Continue();
      }
    }
  } else if (req.query?.email && req.query?.pass) {
    req.query.email = req.query.email.toLowerCase();
    Continue();
  } else {
    res.status(422).json({
      status: 422,
      message: "Email or password wrong",
    });
  }
});

/* 
  Route: POST /forgot-request
  Description: Initiates the forgot password request.
  Middleware: CheckLogged - Middleware function to handle user authentication.
  Parameters:
    - email: Email of the user (String)
  Cases:
    1. If email is provided:
       - Generates a random secret for password reset.
       - Finds the user by email.
       - If user is found:
         - Attempts to insert the password reset request into temporary collection.
         - If successful:
           - Responds with status 200 and the secret along with the user ID.
         - If duplicate key error occurs (email already exists in temporary collection):
           - Updates the existing record with the user ID.
           - Responds with status 200 and the updated secret along with the user ID.
         - If expiration error occurs (document expiration time has passed):
           - Inserts a new record into temporary collection.
           - Responds with status 200 and the secret along with the user ID.
         - If any other error occurs:
           - Responds with status 500 and the error message.
       - If user is not found:
         - Responds with status 422.
    2. If email is not provided:
       - Responds with status 400 and a "Bad Request" message.
*/

router.post("/forgot-request", CheckLogged, async (req, res) => {
  if (req.body?.email) {
    let secret = Math.random().toString(16);
    secret = secret.replace("0.", "");
    let response = null;
    try {
      response = await user.forgotRequest(req.body, secret);
    } catch (err) {
      if (err?.status === 422) {
        res.status(422).json({
          status: 422,
          message: "Email wrong",
        });
      } else {
        res.status(500).json({
          status: 500,
          message: err,
        });
      }
    } finally {
      if (response) {
        fs.readFile(
          `${path.resolve(path.dirname(""))}/mail/template.html`,
          "utf8",
          (err, html) => {
            if (!err) {
              html = html.replace(
                "[URL]",
                `${process.env.SITE_URL}/forgot/set/${response._id}/${response.secret}`
              );
              html = html.replace("[TITLE]", "Reset password");
              html = html.replace(
                "[CONTENT]",
                "A password change has been requested for your account. If this was you, please use the link below to reset your password."
              );
              html = html.replace("[BTN_NAME]", "Reset password");

              sendMail({
                to: req.body.email,
                subject: `Change password for GE CoPilot™`,
                html,
              });
            } else {
              console.log(err);
            }
          }
        );

        res.status(200).json({
          status: 200,
          message: "Success",
        });
      }
    }
  } else {
    res.status(422).json({
      status: 422,
      message: "Email wrong",
    });
  }
});

/* 
  Route: GET /forgot-check
  Description: Checks the validity of the forgot password verification.
  Middleware: CheckLogged - Middleware function to handle user authentication.
  Parameters from Query:
    - userId: User ID (String)
    - secret: Secret for password reset (String)
  Cases:
    1. If userId and secret are provided:
       - Finds the corresponding record in the temporary collection.
       - Finds the user by user ID.
       - If both records exist:
         - Responds with status 200 and a "Success" message.
       - If either record does not exist:
         - Responds with status 404 and a "Wrong Verification" message.
    2. If userId or secret are not provided:
       - Responds with status 404 and a "Wrong Verification" message.
*/

router.get("/forgot-check", CheckLogged, async (req, res) => {
  if (req.query?.userId && req.query?.secret) {
    let response = null;
    try {
      response = await user.checkForgot(req.query);
    } catch (err) {
      if (err?.status === 404) {
        res.status(404).json({
          status: 404,
          message: "Wrong Verification",
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
        });
      }
    }
  } else {
    res.status(404).json({
      status: 404,
      message: "Wrong Verification",
    });
  }
});

/* 
  Route: PUT /forgot-finish
  Description: Completes the forgot password process.
  Middleware: CheckLogged - Middleware function to handle user authentication.
  Parameters:
    - userId: User ID (String)
    - secret: Secret for password reset (String)
    - newPass: New password (String)
    - reEnter: Re-entered new password (String)
  Cases:
    1. If userId, secret, newPass, and reEnter are provided:
       - Validates the new password:
         - Checks if newPass is at least 8 characters long.
         - Compares newPass with reEnter to ensure they are the same.
       - If validation passes:
         - Finds the corresponding record in the temporary collection using userId and secret.
         - If the record exists:
           - Hashes the new password.
           - Updates the user's password in the user collection.
           - Deletes the record from the temporary collection.
           - Responds with status 200 and a "Success" message.
         - If the record does not exist:
           - Responds with status 404 and a "Wrong Verification" message.
       - If validation fails:
         - Responds with status 422 and a message indicating the password requirements.
    2. If userId or secret are not provided:
       - Responds with status 404 and a "Wrong Verification" message.
*/

router.put("/forgot-finish", CheckLogged, async (req, res) => {
  if (req.body?.userId && req.body?.secret) {
    if (
      req.body?.newPass?.length >= 8 &&
      req.body?.reEnter &&
      req.body?.newPass === req.body?.reEnter
    ) {
      let response = null;
      try {
        response = await user.resetPassword(req.body);
      } catch (err) {
        if (err?.status === 404) {
          res.status(404).json({
            status: 404,
            message: "Wrong Verification",
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
          });
        }
      }
    } else {
      res.status(422).json({
        status: 422,
        message:
          "Password must 8 character and New password and Re Enter password must same",
      });
    }
  } else {
    res.status(404).json({
      status: 404,
      message: "Wrong Verification",
    });
  }
});

/* 
  Route: GET /checkUserLogged
  Description: Checks if the user is logged in or not.
  Parameters: None
  Middleware: CheckLogged - Middleware function to clear userToken cookie if user is not logged in.
  Cases:
    1. If user is logged in:
       - Respond with status 208 and a "Already Logged" message along with user data.
    2. If user is not logged in:
       - Respond with status 405 and a "Not Logged User" message.
*/

router.get("/checkUserLogged", CheckLogged, (req, res) => {
  res.status(405).json({
    status: 405,
    message: "Not Logged User",
  });
});

/* 
  Route: DELETE /account
  Description: Deletes the user account.
  Cases:
    1. If userToken cookie is provided and valid:
       - Verifies the JWT token.
       - If token is valid:
         - Finds the user data using the decoded user ID.
         - If user data exists:
           - Calls user.deleteUser(userData._id) to delete the user.
           - If deletion is successful:
             - Clears the userToken cookie.
             - Responds with status 200 and a "Success" message.
           - If user data does not exist:
             - Clears the userToken cookie.
             - Responds with status 405 and a "Not found" message.
         - If any error occurs during the process:
           - If user data does not exist, responds with status 405 and a "Not found" message.
           - Otherwise, responds with status 500 and the error message.
       - If token is invalid:
         - Responds with status 405 and a "Not Logged" message.
    2. If userToken cookie is not provided:
       - Responds with status 405 and a "Not Logged" message.
*/

router.delete("/account", async (req, res) => {
  jwt.verify(
    req.cookies?.userToken,
    process.env.JWT_PRIVATE_KEY,
    async (err, decoded) => {
      if (decoded) {
        let response = null;
        let userData = null;

        try {
          userData = await user.checkUserFound(decoded);
          if (userData) {
            response = await user.deleteUser(userData._id);
          }
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
          if (response) {
            res.clearCookie("userToken").status(200).json({
              status: 200,
              message: "Success",
            });
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
});

/* 
  Route: POST /otp
  Description: Sends an OTP email to the specified email address using Nodemailer.
  Parameters: None
  Cases:
    1. If email is provided:
       - Created a Nodemailer transporter and define email content.
       - Send the OTP email.
       - On success:
         - Respond with status 200 and a "Success" message.
       - On failure:
         - If error status is 422, respond with status 422 and an "Email wrong" message.
         - For other errors, respond with status 500 and the error message.
    2. If email is not provided:
       - Respond with status 422 and an "Email wrong" message.
*/

router.post("/otp", async (req, res) => {
  if (req.body?.email) {
    let response = null;
    try {
      const transporter = nodemailer.createTransport({
        service: "gmail",
        host: "smtp.gmail.com",
        auth: {
          user: process.env.MAIL_EMAIL,
          pass: process.env.MAIL_SECRET,
        },
      });
      const html = `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta http-equiv="X-UA-Compatible" content="IE=edge">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>OTP from GE CoPilot™</title>
        </head>
        <body style="font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;padding: 2rem;height: auto;">
            <main style="background: #FFFFFF;">
                <div>
                    <img src="https://ci3.googleusercontent.com/proxy/RGGaxLm0ifN5YB6SrijKMz6G2lcKMcrApU1aWOvkSRSUclVDoY0yw2_WK4rwbxXMcXE-wpYZqoDcsxiDLS_CKp5IzdMw9toGr0_XwEOG5i4RqySValLO7A=s0-d-e1-ft#https://cdn.openai.com/API/logo-assets/openai-logo-email-header-1.png" width="560" height="168" alt="OpenAI" title="" style="width:140px;height:auto;border:0;line-height:100%;outline:none;text-decoration:none" class="CToWUd" data-bit="iit">
                    <h1 style="color: #202123;font-size: 32px;line-height: 40px;">Your OTP is: ${otp}</h1>
                    <p style="color: #353740;font-size: 16px;line-height: 24px;margin-bottom: 1.8rem;">Use this OTP to proceed with your action.</p>
                </div>
            </main>
        </body>
        </html>`;
      const subject = "Your OTP from GE CoPilot™";

      const options = {
        from: `GE CoPilot™ <${process.env.MAIL_EMAIL}>`,
        to,
        subject,
        html,
      };

      transporter.sendMail(options, (err, info) => {
        if (err) {
          console.error(err);
        } else {
          console.log("Email sent: ", info.response);
          response = "success";
        }
      });
    } catch (err) {
      if (err?.status === 422) {
        res.status(422).json({
          status: 422,
          message: "Email wrong",
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
        });
      }
    }
  } else {
    res.status(422).json({
      status: 422,
      message: "Email wrong",
    });
  }
});

/* 
  Route: POST /send_otp
  Description: Sends an OTP to the user's email and stores the OTP in the TEMP collection (database).
  Parameters: None
  Cases:
    1. If email is provided:
       - Create a Nodemailer transporter (used for sending mails).
       - Define and send an email with the OTP.
       - On success:
         - Update the TEMP collection with the new OTP.
         - Respond with status 200 and a "Success" message.
       - On failure:
         - If error status is 422, respond with status 422 and an "Email wrong" message.
         - For other errors, respond with status 500 and the error message.
    2. If email is not provided:
       - Respond with status 422 and an "Email wrong" message.
    Other: $set is used to update db fields (i.e. OTP & userId)
*/

router.post("/send_otp", async (req, res) => {
  if (req.body?.email) {
    const otp = req.body.otp;
    let response = null;
    try {
      // Create Nodemailer transporter
      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
          user: process.env.MAIL_EMAIL,
          pass: process.env.MAIL_SECRET,
        },
      });

      // Define email options
      const mailOptions = {
        from: `GE CoPilot™ <${process.env.MAIL_EMAIL}>`, // Sender email address
        to: req.body.email, // Recipient email address
        subject: "Your OTP", // Email subject
        text: `Your OTP is: ${otp}`, // Email body
      };

      // Send email
      response = await transporter.sendMail(mailOptions);
    } catch (err) {
      if (err?.status === 422) {
        return res.status(422).json({
          status: 422,
          message: "Email wrong",
        });
      } else {
        return res.status(500).json({
          status: 500,
          message: err,
        });
      }
    } finally {
      if (response) {
        await db.collection(collections.TEMP).updateOne(
          { email: req.body.email }, // Search criteria
          { $set: { otp: req.body.otp, userId: new ObjectId() } }, // Update or create object with otp
          { upsert: true } // Option to insert if not found
        );

        return res.status(200).json({
          status: 200,
          message: "Success",
        });
      }
    }
  } else {
    console.error(err);
    return res.status(422).json({
      status: 422,
      message: "Email wrong",
    });
  }
});

/* 
  Route: POST /verify_otp
  Description: Verifies the user's input OTP against the OTP sent to the user's email (already saved in the database).
  Parameters: None
  Cases:
    1. If the OTP matches:
       - Retrieve user data from the USER collection.
       - Delete the temporary OTP record from the Temp collection.
       - Generate a JWT token and set it as an HTTP-only cookie.
       - Respond with status 200, a success message, and user data.
    2. If the OTP does not match:
       - Respond with status 422 and an "OTP wrong" message.
*/

router.post("/verify_otp", async (req, res) => {
  if (req.body?.email && req.body?.otp) {
    let response = null;
    try {
      response = await db.collection(collections.TEMP).findOne({
        email: req.body.email,
      });
    } catch (err) {
      if (err?.status === 422) {
        return res.status(422).json({
          status: 422,
          message: "Email wrong",
        });
      } else {
        return res.status(500).json({
          status: 500,
          message: err,
        });
      }
    } finally {
      if (response.otp == req.body.otp) {
        const user = await db.collection(collections.USER).findOne({
          email: req.body.email,
        });
        await db.collection(collections.TEMP).deleteOne({
          email: req.body.email,
        });
        let token = jwt.sign(
          {
            _id: user._id,
            email: user.email,
          },
          process.env.JWT_PRIVATE_KEY,
          {
            expiresIn: "24h",
          }
        );

        res
          .status(200)
          .cookie("userToken", token, {
            httpOnly: true,
            expires: new Date(Date.now() + 86400000),
          })
          .json({
            status: 200,
            message: "Success",
            data: user,
          });
      } else {
        return res.status(422).json({
          status: 422,
          message: "OTP wrong",
        });
      }
    }
  }
});

/* 
  Route: GET /logout
  Description: Logout the user out by clearing the authentication cookie from user's browser.
  Parameters: None

*/

router.get("/logout", (req, res) => {
  res.clearCookie("userToken").status(200).json({
    status: 200,
    message: "LogOut",
  });
});

export default router;
