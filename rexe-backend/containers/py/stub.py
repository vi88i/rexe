from functools import wraps
import resource

class rexePyStub:
  def setlimits(self):
    bytes = (1024 * 1024) * %MEMORY_LIMIT%
    time = %TIME_LIMIT%
    rsrcs = [resource.RLIMIT_AS, resource.RLIMIT_DATA, resource.RLIMIT_STACK]
    for rsrc in rsrcs:
      resource.setrlimit(rsrc, (bytes, bytes))
      soft, hard = resource.getrlimit(rsrc)
      assert soft == bytes and hard == bytes

    resource.setrlimit(resource.RLIMIT_CPU, (time, time))
    soft, hard = resource.getrlimit(resource.RLIMIT_CPU)
    assert soft == time and hard == time

  def writeResourceUsage(self):
    rusage = resource.getrusage(resource.RUSAGE_SELF)
    f = open('rusage.txt', 'w')
    f.write(str(rusage[0] * 1000.0) + ',' + str(rusage[2] / 1024.0))
    f.close()

  def __init__(self):
    self.setlimits()

  def __del__(self):
    self.writeResourceUsage()

rexePyStub() 
