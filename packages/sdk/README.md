# shipstat

Native analytics module for React Native and Expo. Part of [Shipstat](https://github.com/MatthysDev/shipstat): open source analytics & A/B testing for mobile apps.

```sh
npx expo install shipstat
```

```ts
import Shipstat from 'shipstat';

Shipstat.init({ endpoint: 'https://api.example.com/events', headers: { Authorization: `Bearer ${token}` } });
Shipstat.setContext({ variant: 'B' });
Shipstat.track('paywall_viewed', { placement: 'onboarding_end' });
```

See the [main README](https://github.com/MatthysDev/shipstat#readme) for the full API, the event format and the dashboard.
