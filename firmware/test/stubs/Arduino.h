#pragma once
#include <cstdint>
#include <cstdio>
#include <cstdarg>
#include <cstring>
#include <string>
#include <cmath>
#define HIGH 1
#define LOW 0
#define INPUT_PULLUP 2
#define OUTPUT 1
#define HEX 16
typedef uint8_t byte;

class String {
 public:
  std::string s;
  String() {}
  String(const char* c) : s(c ? c : "") {}
  String(const std::string& x) : s(x) {}
  String(int v) : s(std::to_string(v)) {}
  String(unsigned int v) : s(std::to_string(v)) {}
  String(long v) : s(std::to_string(v)) {}
  String(unsigned long v) : s(std::to_string(v)) {}
  String(unsigned int v, unsigned char base) { char b[16]; snprintf(b, 16, base == 16 ? "%x" : "%u", v); s = b; }
  String(float v, unsigned char d) { char b[32]; snprintf(b, 32, "%.*f", d, v); s = b; }
  String(double v, unsigned char d) { char b[32]; snprintf(b, 32, "%.*f", d, v); s = b; }
  const char* c_str() const { return s.c_str(); }
  unsigned length() const { return s.size(); }
  bool concat(const char* c) { s += c; return true; }
  bool concat(const char* c, unsigned n) { s.append(c, n); return true; }
  bool concat(char c) { s += c; return true; }
  String& operator+=(const String& o) { s += o.s; return *this; }
  String& operator+=(const char* o) { s += o; return *this; }
  friend String operator+(const String& a, const String& b) { return String(a.s + b.s); }
  friend String operator+(const String& a, const char* b) { return String(a.s + b); }
  bool operator==(const char* o) const { return s == o; }
  bool operator==(const String& o) const { return s == o.s; }
};

struct DeviceIO { int analog[40] = {0}; int digital[40]; int out[40] = {0}; DeviceIO(){ for(int i=0;i<40;i++) digital[i]=HIGH; } };
extern DeviceIO* g_io;
extern unsigned long g_millis;
extern bool g_quiet;
inline unsigned long millis() { return g_millis; }
inline void delay(unsigned long) {}
inline int analogRead(int p) { return g_io->analog[p]; }
inline int digitalRead(int p) { return g_io->digital[p]; }
inline void digitalWrite(int p, int v) { g_io->out[p] = v; }
inline void pinMode(int, int) {}
inline uint32_t esp_random() { return 0x1234abcd; }
struct SerialStub {
  void begin(int) {}
  void print(const char* s) { if (!g_quiet) fputs(s, stdout); }
  void println(const char* s = "") { if (!g_quiet) puts(s); }
  void printf(const char* f, ...) { va_list a; va_start(a, f); vprintf(f, a); va_end(a); }
};
extern SerialStub Serial;
