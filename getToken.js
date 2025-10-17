import clickup from '@api/clickup';

clickup.getAccessToken()
  .then(({ data }) => console.log(data))
  .catch(err => console.error(err));