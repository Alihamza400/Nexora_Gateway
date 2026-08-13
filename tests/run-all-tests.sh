#!/bin/bash

# Crypto Gateway - Test Runner Script
# Runs all tests and generates coverage reports

set -e

echo "🚀 Starting Crypto Gateway Test Suite"
echo "======================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test results tracking
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0

# Function to run tests and track results
run_test_suite() {
    local suite_name=$1
    local test_command=$2
    
    echo ""
    echo -e "${YELLOW}Running $suite_name...${NC}"
    echo "--------------------------------------"
    
    if eval "$test_command"; then
        echo -e "${GREEN}✅ $suite_name passed${NC}"
        PASSED_TESTS=$((PASSED_TESTS + 1))
    else
        echo -e "${RED}❌ $suite_name failed${NC}"
        FAILED_TESTS=$((FAILED_TESTS + 1))
    fi
    
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
}

# 1. Lint and Format Check
echo ""
echo "📝 Step 1: Lint and Format Check"
echo "================================"

if npm run lint && npm run format:check; then
    echo -e "${GREEN}✅ Lint and format checks passed${NC}"
else
    echo -e "${RED}❌ Lint or format checks failed${NC}"
    exit 1
fi

# 2. Type Check
echo ""
echo "🔍 Step 2: TypeScript Type Check"
echo "================================"

if npm run typecheck; then
    echo -e "${GREEN}✅ Type check passed${NC}"
else
    echo -e "${RED}❌ Type check failed${NC}"
    exit 1
fi

# 3. Unit Tests
run_test_suite "Unit Tests" "npm run test:unit"

# 4. Integration Tests
run_test_suite "Integration Tests" "npm run test:integration"

# 5. All Tests with Coverage
echo ""
echo "📊 Step 5: Running All Tests with Coverage"
echo "==========================================="

if npm run test:coverage; then
    echo -e "${GREEN}✅ Coverage report generated${NC}"
else
    echo -e "${YELLOW}⚠️  Coverage report generation failed (non-critical)${NC}"
fi

# Summary
echo ""
echo "======================================"
echo "📋 Test Summary"
echo "======================================"
echo -e "Total test suites: $TOTAL_TESTS"
echo -e "${GREEN}Passed: $PASSED_TESTS${NC}"
echo -e "${RED}Failed: $FAILED_TESTS${NC}"
echo ""

if [ $FAILED_TESTS -eq 0 ]; then
    echo -e "${GREEN}🎉 All tests passed!${NC}"
    exit 0
else
    echo -e "${RED}💥 Some tests failed!${NC}"
    exit 1
fi
