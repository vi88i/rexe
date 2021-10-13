#include <stdio.h>
#include <string.h>
#include <errno.h>
#include <sys/time.h>
#include <sys/resource.h>
#include <stdlib.h>
#include <iostream>
#include <fstream>
#include <assert.h>

class rexeCppStub {
public:
  void setlimits() {
    rlimit limit;
    long bytes = (1024 * 1024) * %MEMORY_LIMIT%;
    long time = %TIME_LIMIT%;

    limit.rlim_cur = bytes;
    limit.rlim_max = bytes;

    if (setrlimit(RLIMIT_AS, &limit) != 0) {
      printf("Error: %s\n", strerror(errno));
      exit(1);    
    }

    if (getrlimit(RLIMIT_AS, &limit) != 0) {
      printf("Error: %s\n", strerror(errno));
      exit(1);
    }

    assert(limit.rlim_cur == bytes && limit.rlim_max == bytes);

    limit.rlim_cur = time;
    limit.rlim_max = time;

    if (setrlimit(RLIMIT_CPU, &limit) != 0) {
      printf("Error: %s\n", strerror(errno));
      exit(1);    
    }

    if (getrlimit(RLIMIT_CPU, &limit) != 0) {
      printf("Error: %s\n", strerror(errno));
      exit(1);
    }

    assert(limit.rlim_cur == time && limit.rlim_max == time);
  }
  void writeResourceUsage() {
    rusage usage;
    if (getrusage(RUSAGE_SELF, &usage) != 0) {
      printf("Error: %s\n", strerror(errno));
      exit(1);
    }
    std::ofstream file("rusage.txt");
    file << (usage.ru_utime.tv_usec / 1000.0) << "," << (usage.ru_maxrss / 1024.0);
    file.close();    
  }    
  rexeCppStub() {
    setlimits();
  }
  ~rexeCppStub() {
    writeResourceUsage();
  }
}_rexeCppStub;
