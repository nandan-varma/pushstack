# creates a dir and runs these to test git push and pull functionality with the local server
# echo "# tacoma" >> README.md
# git init
# git add README.md
# git commit -m "first commit"
# git branch -M main
# git remote add origin http://localhost:3000/api/git/nandan/tacoma.git
# git push -u origin main

mkdir test-git
cd test-git
echo "# tacoma" >> README.md
git init
git add README.md
git commit -m "first commit"
git branch -M main
git remote add origin http://localhost:3000/api/git/nandan/tacoma.git
git push -u origin main

