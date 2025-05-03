const fs = require("fs");
const csv = require("csv-parser");

const parseCSV = async (filePath) =>
  new Promise((resolve, reject) => {
    const results = [];

    fs.createReadStream(filePath)
      .pipe(csv())
      .on("data", (row) => results.push(row))
      .on("end", () => resolve(results))
      .on("error", (err) => reject(err));
  });

module.exports = {
  parseCSV,
};
