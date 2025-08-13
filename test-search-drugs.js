import { searchDrugs } from './build/utils.js';

console.log('Testing searchDrugs function...');

try {
  const results = await searchDrugs('aspirin', 2);
  console.log('Success! Found', results.length, 'results');
  if (results.length > 0) {
    console.log('First result:', JSON.stringify(results[0], null, 2));
  }
} catch (error) {
  console.error('Error:', error.message);
  console.error('Full error:', error);
}
