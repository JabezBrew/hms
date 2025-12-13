# HMS Load Testing

Load testing suite for validating system performance under high load conditions.

## Target Metrics

| Scenario | Users | Target RPS | P95 Latency |
|----------|-------|------------|-------------|
| Dashboard | 5,000 | 500 | < 500ms |
| Search | 1,000 | 100 | < 1s |
| Vitals Write | 500 | 50 | < 200ms |
| WebSocket | 10,000 | N/A | < 100ms (alert delivery) |

## Prerequisites

### Locust
```bash
pip install locust
```

### K6
```bash
# macOS
brew install k6

# Linux
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update
sudo apt-get install k6

# Windows
choco install k6
```

## Running Tests

### Locust (Web UI)

```bash
# Start with web UI
locust -f tests/load/locustfile.py --host=http://localhost:8000

# Open http://localhost:8089 in browser
# Configure users and spawn rate, then start
```

### Locust (Headless)

```bash
# Run 1000 users, spawn 50/sec, for 5 minutes
locust -f tests/load/locustfile.py \
    --host=http://localhost:8000 \
    --headless \
    -u 1000 \
    -r 50 \
    -t 5m \
    --csv=results/load_test
```

### Locust (Distributed)

For higher loads, run in distributed mode:

```bash
# Master node
locust -f tests/load/locustfile.py \
    --master \
    --host=http://localhost:8000

# Worker nodes (run on multiple machines)
locust -f tests/load/locustfile.py \
    --worker \
    --master-host=<master-ip>
```

### K6

```bash
# Basic run
k6 run tests/load/k6-test.js

# With custom base URL
k6 run -e BASE_URL=http://api.example.com tests/load/k6-test.js

# Output to JSON
k6 run --out json=results.json tests/load/k6-test.js

# Cloud run (requires k6 Cloud account)
k6 cloud tests/load/k6-test.js
```

## Test Scenarios

### Nurse Dashboard (50% of users)
- View nursing dashboard
- Check patient vitals
- Record new vitals
- View/acknowledge alerts
- Check medication schedule

### Doctor Workflow (30% of users)
- View appointments
- Search patients
- View patient details
- View clinical notes

### Admin/Ward Management (20% of users)
- View ward list
- View ward analytics
- Check occupancy

## Test Users

Create test users before running load tests:

```python
# Django shell
from django.contrib.auth import get_user_model
User = get_user_model()

# Create test nurse
User.objects.create_user(
    username='nurse@example.com',
    email='nurse@example.com',
    password='AdminPassword123',
    user_type='nurse'
)

# Create test doctor
User.objects.create_user(
    username='doctor@example.com',
    email='doctor@example.com',
    password='AdminPassword123',
    user_type='doctor'
)

# Create test admin
User.objects.create_superuser(
    username='admin@example.com',
    email='admin@example.com',
    password='AdminPassword123'
)
```

## Analyzing Results

### Locust CSV Output

```bash
# Results are saved to:
# - results/load_test_stats.csv (request statistics)
# - results/load_test_stats_history.csv (time series)
# - results/load_test_failures.csv (failed requests)
```

### K6 JSON Output

```bash
# Parse with jq
cat results.json | jq '.metrics.http_req_duration'

# Or use k6 cloud for visualization
k6 cloud tests/load/k6-test.js
```

## Interpreting Results

### Good Results
- P95 latency < 500ms
- Error rate < 1%
- No timeout errors
- Consistent throughput

### Warning Signs
- P95 latency > 1s
- Error rate > 1%
- Increasing latency over time (memory leak)
- Timeout errors (connection issues)

### Common Issues

1. **High latency on dashboard**: Check N+1 queries, add caching
2. **Timeout errors**: Increase connection pool size
3. **5xx errors under load**: Scale up pods, check database connections
4. **WebSocket disconnects**: Check Redis channel layer capacity

## CI/CD Integration

### GitHub Actions

```yaml
- name: Run Load Tests
  run: |
    pip install locust
    locust -f tests/load/locustfile.py \
      --host=${{ secrets.TEST_API_URL }} \
      --headless \
      -u 100 \
      -r 10 \
      -t 2m \
      --csv=results/load_test

- name: Upload Results
  uses: actions/upload-artifact@v3
  with:
    name: load-test-results
    path: results/
```

### Threshold-based Pass/Fail

K6 automatically fails if thresholds are not met:

```javascript
thresholds: {
  http_req_duration: ['p(95)<500'],  // Fails if P95 > 500ms
  http_req_failed: ['rate<0.01'],    // Fails if error rate > 1%
}
```
