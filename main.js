const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const fs = require("fs/promises");
const path = require("path");
const { exec, spawn } = require("child_process");
const { stdout, cwd } = require("process");
const app = express();
const port = 3001;
let check = false;
let flag = false;
let appStatus;
let jsonData;
const publicDir = path.join(__dirname, "public");
const dataDir = path.join(process.cwd(), "data");
app.use(express.static(publicDir));
app.use(bodyParser.json());

// Function to create the 'data' directory if it doesn't exist

const checkInStore = async () => {
  return new Promise((resolve, reject) => {
    if (process.platform == "darwin" || process.platform == "linux") {
      resolve(0);
    } else if (process.platform == "win32") {
      exec(
        `wmic path Win32_DesktopMonitor where "PNPDeviceID is not null" get DeviceID /format:list`,
        (error, stdout) => {
          if (!error && stdout) {
            const outputLines = stdout.split("\r\r\n");
            const deviceIDLines = outputLines.filter((line) =>
              line.startsWith("DeviceID=")
            );
            const connectedMonitorsCount = deviceIDLines.length;
            resolve(connectedMonitorsCount);
            return connectedMonitorsCount;
          } else {
            reject("App is not running on Windows.");
            console.error("App is not running on Windows.");
          }
        }
      );
    } else {
      console.log("Unsupported operating system.");
      reject("Unsupported operating system.");
    }
  });
};

const checkVrConnected = () => {
  return new Promise((resolve, reject) => {
    if (process.platform == "darwin" || process.platform == "linux") {
      resolve(false);
    } else if (process.platform == "win32") {
      const platformToolsPath = "C:\\platform-tools\\platform-tools";

      // Command to check if the platform tools path exists, download if not
      const checkPlatformToolsCommand = `if ( -not (Test-Path "${platformToolsPath}") ) { Invoke-WebRequest -Uri "https://dl.google.com/android/repository/platform-tools-latest-windows.zip" -OutFile "platform-tools.zip"; Expand-Archive -Path "platform-tools.zip" -DestinationPath "${platformToolsPath}" -Force }`;

      // Command to change directory and run adb devices
      const adbCommand = `cd ${platformToolsPath}; .\\adb.exe devices`;

      // Executing PowerShell commands
      exec(
        `powershell.exe -ExecutionPolicy ByPass -Command "${checkPlatformToolsCommand}; ${adbCommand}"`,
        (error, stdout, stderr) => {
          if (error) {
            reject(`Error: ${error.message}`);
            return;
          }
          if (stderr) {
            reject(`Command execution failed: ${stderr}`);
            return;
          }
          const outputLines = stdout.split("\n");
          if (outputLines[1].trim().length > 0) {
            resolve(true);
          } else {
            resolve(false);
          }
        }
      );
    } else {
      console.log("Unsupported operating system.");
      reject("Unsupported operating system.");
    }
  });
};

const createDataDirectory = async () => {
  try {
    await fs.mkdir(dataDir, { recursive: true });
  } catch (error) {
    if (error.code === "ENOENT") {
      await fs.mkdir(dataDir, { recursive: true });
    } else if (error.code === "EEXIST") {
      console.log("'data' folder already exists.");
    } else {
      console.error("Error creating 'data' folder:", error);
    }
  }
};

//Function to check if data directory exists
const checkDataDirectory = async () => {
  try {
    await fs.access(dataDir);
    console.log("'data' folder exists.");
  } catch (error) {
    if (error.code === "ENOENT") {
      console.log("'data' folder does not exist.");
      await createDataDirectory();
    } else {
      console.error("Error checking 'data' folder:", error);
    }
  }
};

//function to fetch data
const fetchData = async () => {
  // Ensure the 'data' directory exists
  await checkDataDirectory();

  try {
    const jsonFiles = (await fs.readdir(dataDir)).filter((file) =>
      file.endsWith(".json")
    );
    if (jsonFiles == [] || jsonFiles.length > 0) {
      const firstJsonFile = jsonFiles[0];
      const res = JSON.parse(
        await fs.readFile(path.join(dataDir, firstJsonFile), "utf-8")
      );
      return res;
    }
  } catch (error) {
    console.error("Error reading JSON data:", error, dataDir, "hello");
  }
  return null;
};

const checkAppRunning = async (appName) => {
  if (!appName) return false;

  let truncatedString;

  if (appName.length > 20) {
    truncatedString = appName.substring(0, 20);
  } else {
    truncatedString = appName;
  }

  console.log("App Name:", appName);
  console.log("Truncated App Name:", truncatedString);
  return new Promise((resolve, reject) => {
    if (process.platform == "darwin" || process.platform == "linux") {
      exec(
        `ps -ef | grep '${appName}'| awk '{ print $8 }'`,
        async (error, stdout) => {
          if (stdout.includes(appName)) {
            appStatus = true;
            resolve(true);
          } else {
            console.log(`app ${appName} isn't running`);
            const failedData = await fetchData();
            const monitor = await checkInStore();
            const vr = await checkVrConnected();
            appStatus = false;
            const sendData = {
              client: failedData.client,
              store: failedData.store,
              software: failedData.software,
              app: appName,
              status: appStatus,
              additionalData: {
                devices: monitor,
                vr: vr,
              },
            };
            const dt = await sendPing(sendData);
            console.log(dt.data);

            resolve(false);
          }
        }
      );
    } else if (process.platform === "win32") {
      exec(
        `tasklist /FI "IMAGENAME eq ${appName}.exe"`,
        async (error, stdout) => {
          if (
            !error &&
            stdout.toLowerCase().includes(truncatedString.toLowerCase())
          ) {
            appStatus = true;
            resolve({ success: true, isRunning: true });
            console.log("App is running on Windows.");
          } else {
            appStatus = false;
            const failedData = await fetchData();
            const monitor = await checkInStore();
            const vr = await checkVrConnected();
            const sendData = {
              client: failedData.client,
              store: failedData.store,
              software: failedData.software,
              app: appName,
              status: appStatus,
              additionalData: {
                devices: monitor,
                vr: vr,
              },
            };
            await sendPing(sendData);

            reject("App is not running on Windows.");
            console.error("App is not running on Windows.");
          }
        }
      );
    } else {
      console.log("Unsupported operating system.");
      reject("Unsupported operating system.");
    }
  });
};

const initializeJsonData = async () => {
  jsonData = await fetchData();
  if (jsonData) {
    return jsonData;
  }
};

const sendPing = async (jsonData) => {
  console.log(jsonData, "this is data");
  try {
    const apiResponse = await axios.post(
      "https://api.metadome.ai/heartbeat-dev/ping",
      jsonData
    );
    return apiResponse.data;
  } catch (error) {
    console.error("API error:", error);
    throw new Error("Error submitting data to the API.");
  }
};

const removeOldData = async (data) => {
  try {
    const client = data.client;
    const store = data.store;
    const software = data.software;
    const app = data.app;
    const deleteEntry = await axios.delete(
      `https://api.metadome.ai/heartbeat-dev/ping/delete?client=${client}&store=${store}&software=${software}&app=${app}`
    );
    return deleteEntry;
  } catch (error) {
    console.error("API error:", error);
    throw new Error("Error submitting data to the API.");
  }
};

// const findRemovedData = async(obj1, obj2){

// }

app.get("/data", async (req, res) => {
  const resp = await fetchData();
  if (resp) {
    return res.json({ result: resp });
  } else {
    res.status(404).json({ error: "Data not found" });
  }
});

app.put("/update", async (req, res) => {
  const oldData = await fetchData();

  const data = req.body;
  try {
    if (
      !data ||
      !data.client ||
      !data.store ||
      !data.software ||
      !data.appsArray
    ) {
      return res.status(400).json({ error: "Invalid data in the request" });
    }

    const oldDataApps = oldData.appsArray;
    const newDataApps = data.appsArray;
    oldDataApps.forEach(async (entry) => {
      if (!newDataApps.includes(entry)) {
        const deleteData = {
          client: data.client,
          store: data.store,
          software: data.software,
          app: entry,
        };
        const checkRemoved = await removeOldData(deleteData);
      }
    });

    const dataDir = path.join(process.cwd(), "data");

    const jsonFiles = await fs.readdir(dataDir);

    const filteredJsonFiles = jsonFiles.find((file) => file.endsWith(".json"));
    if (filteredJsonFiles.length > 0) {
      jsonData = {
        client: data.client,
        store: data.store,
        software: data.software,
        appsArray: data.appsArray,
      };
      const dataToWrite = JSON.stringify(jsonData, null, 2);
      const clientFile = path.join(dataDir, filteredJsonFiles);
      const checkFile = await fs.access(clientFile);
      fs.writeFile(clientFile, dataToWrite, {
        encoding: "utf8",
        flag: "w",
      });
      const monitor = await checkInStore();
      const vr = await checkVrConnected();
      newDataApps.forEach(async (entry) => {
        const firstPing = {
          client: data.client,
          store: data.store,
          software: data.software,
          app: entry,
          status: appStatus,
          additionalData: {
            devices: monitor,
            vr: vr,
          },
        };
        await sendPing(firstPing);
      });
      return res.status(200).json({ message: "Data updated successfully" });
    } else {
      console.log("No JSON files found in the directory.");
    }
  } catch (error) {
    console.log("error editing file :", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

app.post("/submit", async (req, res) => {
  const formData = req.body;

  if (!formData.client || !formData.store || !formData.software) {
    console.error("Missing client, store, or software in formData.");
    return res.status(400).send("Missing client, store, or software.");
  }

  const filePath = path.join(dataDir, `${formData.client}.json`);

  const result = JSON.stringify(formData, null, 2);
  try {
    await fs.writeFile(filePath, result);
    initializeJsonData();
    const appsArray = formData.appsArray || [];
    flag = true;
    const monitor = await checkInStore();
    const vr = await checkVrConnected();
    appsArray.forEach(async (entry) => {
      const firstPing = {
        client: formData.client,
        store: formData.store,
        software: formData.software,
        app: entry,
        status: appStatus,
        additionalData: {
          devices: monitor,
          vr: vr,
        },
      };
      await sendPing(firstPing);
    });
    return res.redirect("/success");
  } catch (error) {
    console.error("Error writing JSON file:", error);
    return res.status(500).send("Error writing JSON file.");
  }
});

app.get("/", (req, res) => {
  const pp = path.join(publicDir, "index.html");
  console.log(pp, "this is home");
  res.sendFile(path.join(publicDir, "index.html"));
});

app.get("/home", (req, res) => {
  res.sendFile(path.join(publicDir, "data.html"));
});

app.get("/edit", (req, res) => {
  res.sendFile(path.join(publicDir, "edit.html"));
});

app.get("/success", (req, res) => {
  const pp = path.join(publicDir, "success.html");
  console.log(pp, "this is home");
  flag = true;
  res.sendFile(path.join(publicDir, "success.html"));
});

app.post("/flag", (req, res) => {
  let { flag } = req.body;

  if (flag !== undefined) {
    const newFlag = Boolean(flag);
    flag = newFlag;
    check = flag;
    res.json({ flag: newFlag });
  } else {
    res.status(400).json({ error: "Invalid flag value" });
  }
});

app.listen(port, async () => {
  console.log(`Server is running on port ${port}`);
  jsonData = await fetchData();
  flag = false;
  if (jsonData) {
    openBrowser(`http://localhost:${port}/home`);
  } else {
    openBrowser(`http://localhost:${port}`);
  }
});

const openBrowser = (url) => {
  switch (process.platform) {
    case "darwin":
      spawn("open", [url]);
      break;
    case "win32":
      spawn("start", [url], { shell: true });
      break;
    default:
      spawn("xdg-open", [url]);
  }
};

const main = async () => {
  const vr = await checkVrConnected();
  console.log(vr, "in main vr");
  const monitor = await checkInStore();

  if (check === false) {
    console.log("Not started interval yet");
  } else {
    if (!jsonData) {
      console.log("data not found");
    } else {
      console.log("Checking app status of :", jsonData);
      const appsArray = jsonData.appsArray || [];
      for (let i = 0; i < appsArray.length; i++) {
        let eachApp = appsArray[i];
        try {
          const checkApp = await checkAppRunning(eachApp);
          if (checkApp) {
            console.log(`app ${eachApp} is running`);
            const appData = {
              client: jsonData.client,
              store: jsonData.store,
              software: jsonData.software,
              app: eachApp,
              status: appStatus,
              additionalData: {
                devices: monitor,
                vr: vr,
              },
            };
            const checkData = await sendPing(appData);
          } else {
            console.log("App is not running");
          }
        } catch (error) {
          console.error("Error checking app status:", error.message);
        }
      }
    }
  }
};

const platformToolsPath = "C:\\platform-tools";

const checkPlatformToolsCommand = `if ( -not (Test-Path "${platformToolsPath}") ) { Invoke-WebRequest -Uri "https://dl.google.com/android/repository/platform-tools-latest-windows.zip" -OutFile "platform-tools.zip"; Expand-Archive -Path "platform-tools.zip" -DestinationPath "${platformToolsPath}" -Force }`;
exec(
  `powershell.exe -ExecutionPolicy ByPass -Command "${checkPlatformToolsCommand}"`,
  (error, stdout, stderr) => {
    if (error) {
      console.error(`Error: ${error.message}`);
      return;
    }
    if (stderr) {
      console.error("Failed to download");
      return;
    }
  }
);

setInterval(() => {
  main();
}, 60 * 60 * 1000);
