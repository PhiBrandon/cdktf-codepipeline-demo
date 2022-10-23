const https = require("https");
let url =
  "https://discordapp.com/api/webhooks/1030918680911036416/04qHVB438bIct79r0SsaypfoycA5mEkqz_q_T65txri8h0ijwYEY__K_Ca5BpWJgEKXA";

exports.handler = async function (event) {
  const eventOutput = "Pipeline" + event.detail.pipeline + " " + event.detail.stage + ": " + event.detail.state + " at: " + event.time
  const data = JSON.stringify({ content: eventOutput });
  const options = {
    hostname: "discordapp.com",
    port: 443,
    path: "/api/webhooks/1030918680911036416/04qHVB438bIct79r0SsaypfoycA5mEkqz_q_T65txri8h0ijwYEY__K_Ca5BpWJgEKXA",
    method: "POST",
    headers: { "Content-Type": "application/json" },
  };

  const promise = new Promise(function (resolve, reject) {
    const req = https.request(options, (res) => {
      const body = [];
      res.on("data", (chunk) => body.push(chunk));
      res.on("end", () => {
        const resString = Buffer.concat(body).toString();
        resolve(resString);
      });
    });
    req.on("error", (e) => {
      reject(Error(e));
    });
    req.write(data);
    req.end();
  });
  return promise;
};
