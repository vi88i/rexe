#include<iostream>
using namespace std;
class A {
public:
 A(A *pa){pa->f();}
 virtual void f()=0;
};
class D : public A {
public:
 D():A(this){}
 virtual void f() {cout<<"D::f\n";}
};
int main(){
 D d;
 A *pa = &d;
 pa->f();
 return 0;
}