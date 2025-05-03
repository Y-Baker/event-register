const { getKey, setKey } = require("../../services/keydbService")
const { generate_key } = require("../../utils/genKey")

const getAllkeys = async (req, res) => {
  const organizer_key = await getKey(process.env.ORGANIZER_ID)
  const scanner_key = await getKey(process.env.SCANNER_ID)

  res.status(200).json({
    organizer: organizer_key,
    scanner: scanner_key
  })
}

const getKeyByName = async (req, res) => {
  const keyName = req.params.KeyName.toLowerCase();
  let key;
  switch (keyName) {
    case 'organizer':
      key = process.env.ORGANIZER_ID
      break;
    case 'scanner':
      key = process.env.SCANNER_ID
      break;
    default:
      res.status(400).json({
        message: 'Invalid Key Name'
      });
      break;
  }

  const key_val = await getKey(key);
  res.status(200).json(key_val);
}

const issueNewKey = async (req, res) => {
  const keyName = req.params.KeyName.toLowerCase();

  let key;
  switch (keyName) {
    case 'organizer':
      key = process.env.ORGANIZER_ID
      break;
    case 'scanner':
      key = process.env.SCANNER_ID
      break;
    default:
      res.status(400).json({
        message: 'Invalid Key Name'
      });
      break;
  }

  const newValue = generate_key();
  

  try {
    await setKey(key, newValue, 60 * 60 * 24 * 7);
  } catch {
    res.status(500).json({
      message: 'Failed to Set Key'
    });
  }

  res.status(200).json(newValue);
}

module.exports = {
  getAllkeys,
  getKeyByName,
  issueNewKey
}
